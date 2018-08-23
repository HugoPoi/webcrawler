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

class Crawler{

  constructor(config, seedUrls){
    const self = this;
    this.emitter = new EventEmitter();

    // TODO implement a queue storage wrapper for cold storage
    let todoUrls = {}; // Store url to do and currently in progress
    let doneUrls = {};

    this.todoUrls = todoUrls;
    this.doneUrls = doneUrls;

    // TODO proper way to implement/config QueueClass
    class UrlQueueClass {
      constructor() {
        this._queue = [];
        this._lowPriorityQueue = []; // Store pending todo urls have low priority
      }
      enqueue(run, context) {
        if(config.priorityRegExp && (
          config.priorityRegExp.test(_.get(context, 'new.url')) ||
          config.priorityRegExp.test(_.get(context, 'new.text')) ||
          config.priorityRegExp.test(_.get(context, 'parent.metas.title'))
          )){
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

    const queue = new PQueue({ concurrency: config.concurrency || 20, queueClass: UrlQueueClass });
    this.queue = queue;

    // TODO choose a standard input for the seeds.
    seedUrls.forEach( urlData => {
      if(!urlData.statusCode){
        todoUrls[urlData.url] = urlData;
        queue.add(() => crawl(urlData)); // TODO Loose context with priorityRegExp
      }else{
        doneUrls[urlData.url] = urlData;
      }
    });



    function crawl(urlData){
      debug('Start extract urls on %s', urlData.url);
      return self.extractUrls(urlData.url, config.headers)
      .then(([newUrls, response, metas]) => {
        if(!newUrls || !response){
          return;
        }
        urlData.statusCode = response.statusCode;
        urlData.metas = metas;
        delete todoUrls[urlData.url];
        doneUrls[urlData.url] = urlData;
        self.emitter.emit('url.done', urlData);
        self.emitter.emit('progress', self.getInfoCount());
        if(config.nofollow && urlData.metas && /nofollow/i.test(urlData.metas.robots)){
          return;
        }
        if(config.noindex && urlData.metas && /noindex/i.test(urlData.metas.robots)){
          return;
        }
        if(config.useCanonical && urlData.metas.canonical){
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
          if(!config.includeSubdomain){
            return parsedUrl.hostname === config.hostname && !parsedUrl.pathname.endsWiths(['.jpg', '.png', '.pdf', '.mp4', '.mp3', '.zip', '.gif', '.rar']);
          }else{
            return Tldjs.getDomain(parsedUrl.hostname) === Tldjs.getDomain(config.hostname) && !parsedUrl.pathname.endsWiths(['.jpg', '.png', '.pdf', '.mp4', '.mp3', '.zip', '.gif', '.rar']);
          }
        })
        .uniqBy('url')
        .filter(newUrlObj => {
          return !doneUrls[newUrlObj.url] && !todoUrls[newUrlObj.url];
        })
        .value();
        if(config.limit && Object.keys(doneUrls).length >= config.limit ){
          queue.pause();
          queue.clear();
          if(config.exportTodoUrls){
            urlsToMerge.forEach(function(el){
              todoUrls[el.url] = el;
            });
          }
        }else{
          urlsToMerge.forEach(function(el){
            todoUrls[el.url] = el;
            queue.add(() => crawl(el), { new: el, parent: urlData });
          });
        }
      })
      .catch({name: 'RequestError'}, error => {
        console.error('Webcrawler network error for %s', urlData.url, error);
        urlData.statusCode = -1;
        delete todoUrls[urlData.url];
        doneUrls[urlData.url] = urlData;
        self.emitter.emit('url.done', urlData);
      });
    }

    if(config.timeout){
      Promise.delay(config.timeout)
      .then(() =>  queue.pause())
      .then(() => queue.clear());
    }

    this.promise = queue.onIdle().then(() => { // TODO use a start method to return the promise
      debug('Queue onIdle, jobs done.');
      let urls = _.values(doneUrls);
      if(config.exportTodoUrls){
        urls = urls.concat(_.values(todoUrls));
      }
      return urls;
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
    this.queue.start();
  }

  extractUrls(currentUrl, headers){
    return Request({
      headers: _.defaults(headers, {
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
        return Promise.delay(10000);
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
      lowPriorityQueue: this.queue.queue._lowPriorityQueue.length
    };
  }

}

module.exports = Crawler;
