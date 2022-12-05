'use strict';
const Cheerio = require('cheerio');
const Request = require('request-promise');
const Url = require('url');
const _ = require('lodash');
const debug = require('debug')('webcrawler');
Promise = require('bluebird');
const Tldjs = require('tldjs');
const EventEmitter = require('events');
const PQueue = require('p-queue');
const SitemapHelpers = require('./sitemap');

// TODO : crade ?
if (typeof String.prototype.endsWiths !== 'function') {
  String.prototype.endsWiths = function(suffixes) {
    var self = this, endWith = false;
    suffixes.forEach(function(test){
      if(self.indexOf(test, self.length - test.length) !== -1){
        endWith = true;
      }
    });
    return endWith;
  };
}

class Crawler extends SitemapHelpers{

  constructor(config, seedUrls){
    super();
    this.emitter = new EventEmitter();
    debug('crawler config', config);
    this.config = config;

    // TODO implement a queue storage wrapper for cold storage
    this.todoUrls = {}; // Store url to do and currently in progress
    this.doneUrls = {};

    // TODO is there a better way to implement/config QueueClass ?
    class UrlQueueClass {
      constructor() {
        this._queue = [];
        this._lowPriorityQueue = []; // Store pending todo urls have low priority
      }
      enqueue(run, context) {
        if((config.priorityRegExp && (
          config.priorityRegExp.test(_.get(context, 'new.url')) ||
          config.priorityRegExp.test(_.get(context, 'new.text')) ||
          config.priorityRegExp.test(_.get(context, 'parent.metas.title'))
          )) || (context && context.isSitemap)){
          this._queue.push(run);
        }else{
          this._lowPriorityQueue.push(run);
        }
      }
      dequeue() {
        return this._queue.shift() || this._lowPriorityQueue.shift();
      }
      get size() {
        return this._queue.length + this._lowPriorityQueue.length;
      }
    }

    this.queue = new PQueue({ autoStart: false, concurrency: config.concurrency || 20, queueClass: UrlQueueClass });

    // TODO choose a standard input for the seeds.
    seedUrls.forEach( urlData => {
      if(!urlData.statusCode){
        this.todoUrls[urlData.url] = urlData;
        this.queue.add(() => this.crawl(urlData)); // TODO Loose context with priorityRegExp
      }else{
        this.doneUrls[urlData.url] = urlData;
      }
    });
    this.initialSeedUrl = seedUrls[0].url;

    if(config.useSitemap){
      this.emitter.on('url.new', (newUrlObj) => {
        let parsedUrl = Url.parse(newUrlObj.url);
        let domainLimit = this.config.includeSubdomain ? Tldjs.getDomain(parsedUrl.hostname) === Tldjs.getDomain(this.config.hostname) : parsedUrl.hostname === this.config.hostname;
        if(domainLimit &&
          !parsedUrl.pathname.endsWiths(['.jpg', '.png', '.pdf', '.mp4', '.mp3', '.zip', '.gif', '.rar']) &&
          !this.doneUrls[newUrlObj.url] &&
          !this.todoUrls[newUrlObj.url]){ // Check if url already in queue
          this.todoUrls[newUrlObj.url] = newUrlObj;
          this.queue.add(() => this.crawl(newUrlObj), { new: newUrlObj });
        }
      });
    }

    if(config.timeout){
      Promise.delay(config.timeout)
      .then(() =>  this.stop());
    }
  }

  crawl(urlData){
    debug('Start extract urls on %s', urlData.url);
    return this.extractUrls(urlData.url)
      .then(([newUrls, response, metas]) => {
        if(!newUrls || !response){
          return;
        }
        urlData.statusCode = response.statusCode;
        urlData.metas = metas;
        delete this.todoUrls[urlData.url];
        this.doneUrls[urlData.url] = urlData;
        this.emitter.emit('url.done', urlData);
        this.emitter.emit('progress', this.getInfoCount());
        if(!this.config.forceNoFollow && urlData.metas && /nofollow/i.test(urlData.metas.robots)){
          return;
        }
        if(!this.config.forceNoIndex && urlData.metas && /noindex/i.test(urlData.metas.robots)){
          return;
        }
        if(this.config.useCanonical && urlData.metas.canonical){
          newUrls.push({ url: urlData.metas.canonical });
        }
        let urlsToMerge = _.chain(newUrls)
          .filter(newUrlObj => {// TODO maybe this can be overide by config ?
            let parsedUrl = Url.parse(newUrlObj.url);
            if(!/^https?:$/.test(parsedUrl.protocol) || !parsedUrl.pathname){
              return false;
            }
            delete parsedUrl.hash; // TODO do this as option and add possiblity to ignore certain request params
            newUrlObj.url = Url.format(parsedUrl);
            newUrlObj.parent = urlData;
            let domainLimit = this.config.includeSubdomain ? Tldjs.getDomain(parsedUrl.hostname) === Tldjs.getDomain(this.config.hostname) : parsedUrl.hostname === this.config.hostname;
            return domainLimit && !parsedUrl.pathname.endsWiths(['.jpg', '.png', '.pdf', '.mp4', '.mp3', '.zip', '.gif', '.rar']);
          })
          .uniqBy('url')
          .filter(newUrlObj => {
            return !this.doneUrls[newUrlObj.url] && !this.todoUrls[newUrlObj.url]; // Check if url already in queue
          })
          .value();
        if(this.config.limit && Object.keys(this.doneUrls).length >= this.config.limit ){
          this.queue.pause();
          this.queue.clear();
          if(this.config.exportTodoUrls){
            urlsToMerge.forEach(el => {
              this.todoUrls[el.url] = el;
            });
          }
        }else{
          urlsToMerge.forEach(el => {
            this.todoUrls[el.url] = el;
            this.queue.add(() => this.crawl(el), { new: el, parent: urlData });
          });
        }
      })
      .catch({name: 'RequestError'}, error => {
        console.error('Webcrawler network error for %s', urlData.url, error);
        urlData.statusCode = -1;
        delete this.todoUrls[urlData.url];
        this.doneUrls[urlData.url] = urlData;
        this.emitter.emit('url.done', urlData);
      });
  }

  stop(){
    this.queue.pause();
    this.queue.clear();
    return this.promise;
  }

  pause(){
    this.queue.pause();
  }

  start(){
    if(this.promise){
      this.queue.start();
      return this.promise;
    }else{
      this.promise = Promise.resolve()
        .then(() => {
          if(this.config.useSitemap){
            return this.getSitemapUrlsFromRobotsTxt().then(sitemapUrls => {
              sitemapUrls.forEach(sitemapUrl => this.queue.add(() => this.crawlSitemap(sitemapUrl), { isSitemap: true }));
            });
          }
        })
        .then(() => this.queue.start())
        .then(() => this.queue.onIdle())
        .then(() => {
          debug('Queue onIdle, jobs done.');
          let urls = _.values(this.doneUrls);
          if(this.config.exportTodoUrls){
            urls = urls.concat(_.values(this.todoUrls));
          }
          return urls;
        });
      return this.promise;
    }
  }

  crawlSitemap(sitemapUrl){
    return this.loadSitemap(sitemapUrl).then(([newSitemapUrls]) => {
      this.emitter.emit('progress', this.getInfoCount());
      newSitemapUrls.forEach(sitemapUrl => this.queue.add(() => this.crawlSitemap(sitemapUrl), { isSitemap: true }));
    });
  }

  extractUrls(currentUrl){
    return Request({
      headers: _.defaults(this.config.headers, {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
      }),
      gzip: true,
      followRedirect: false,
      simple: false,
      resolveWithFullResponse: true,
      url: currentUrl,
      // TODO tweak Agent for custom parameter keep-alive
      forever: true
    })
    .then(response => {
      let newUrls = [];
      let metas = {};
      if (response.statusCode === 200) {
        let $ = Cheerio.load(response.body);
        metas.lang = $('html').attr('lang') || $('head > meta[http-equiv="Content-Language"]').attr('content');
        metas.robots = $('head > meta[name="robots"]').attr('content');
        if($('head > link[rel="canonical"]').attr('href')){
          metas.canonical = Url.resolve(currentUrl, $('head > link[rel="canonical"]').attr('href'));
        }
        metas.title = $('head > title').text();
        $('a').each(function(){
          let href = $(this).attr('href');
          let text = $(this).text().trim();
          if(href){
            newUrls.push({ url: Url.resolve(currentUrl, href), text: text });
          }
        });
      }
      else if (response.statusCode === 301 || response.statusCode === 302) {
        let redirectionUrl = Url.resolve(currentUrl, response.headers.location);
        debug('Redirection 3xx %s to %s', currentUrl, redirectionUrl);
        newUrls.push({ url: redirectionUrl });
      }
      else if (response.statusCode === 429){
        console.error('Warning get 429 Too many request for %s', currentUrl);
        return Promise.delay(10000).return([]);
      }
      else{
        debug('Response code %d for %s', response.statusCode, currentUrl);
      }

      return [newUrls, response, metas];
    });
  }

  getInfoCount(){
    return {
      done: Object.keys(this.doneUrls).length,
      todo: Object.keys(this.todoUrls).length,
      queue: this.queue.queue._queue.length,
      lowPriorityQueue: this.queue.queue._lowPriorityQueue.length,
      pending: this.queue.pending, // equal to concurrency when running
    };
  }

}

module.exports = Crawler;
