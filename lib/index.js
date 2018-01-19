const Cheerio = require('cheerio');
const Request = require('request-promise');
const Url = require('url');
const _ = require('lodash');
const debug = require('debug')('webcrawler');
const Promise = require('bluebird');
const Tldjs = require('tldjs');
const EventEmitter = require('events');
const PQueue = require('p-queue');

// TODO : useless ?
class UrlDoneEmitter extends EventEmitter {}

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
    const urlDoneEmitter = new UrlDoneEmitter();

    let todoUrls = {}; // Store url to do and currently in progress
    let doneUrls = {};
    let priorityRegExp;

    // TODO proper way to implement/config QueueClass
    if(config.priorityRegExp){
      priorityRegExp = new RegExp(config.priorityRegExp, 'i');
    }
    class UrlQueueClass {
      constructor() {
        this._queue = [];
      }
      enqueue(run, context) {
        if(priorityRegExp && (priorityRegExp.test(context.new.url) || priorityRegExp.test(context.new.text) || priorityRegExp.test(context.parent.metas.title))){
          this._queue.splice(0, 0, run);
        }else{
          this._queue.push(run);
        }
      }
      dequeue() {
        return this._queue.shift();
      }
      get size() {
        return this._queue.length;
      }
    }

    const queue = new PQueue({ concurrency: config.concurrency || 20, queueClass: UrlQueueClass });

    // TODO choose a standard input for the seeds.
    _.filter(seedUrls, urlData => {
      return !urlData.statusCode;
    }).forEach( urlData => {
      todoUrls[urlData.url] = urlData;
      queue.add(() => crawl(urlData));
    });

    function crawl(urlData){
      debug('Start extract urls on %s', urlData.url);
      return self.extractUrls(urlData.url)
      .then(([newUrls, response, metas]) => {
        if(!newUrls || !response){
          return;
        }
        urlData.statusCode = response.statusCode;
        urlData.metas = metas;
        delete todoUrls[urlData.url];
        doneUrls[urlData.url] = urlData;
        urlDoneEmitter.emit('url.done', urlData);
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
      .catch(error => { // TODO catch only network error
        urlData.statusCode = 523;
        delete todoUrls[urlData.url];
        doneUrls[urlData.url] = urlData;
        urlDoneEmitter.emit('url.done', urlData);
      });
    }

    if(config.timeout){
      Promise.delay(config.timeout)
      .then(() =>  queue.pause())
      .then(() => queue.clear());
    }

    this.promise = queue.onIdle().then(() => {
      let urls = _.values(doneUrls);
      if(config.exportTodoUrls){
        urls = urls.concat(_.values(todoUrls));
      }
      return urls;
    });
    this.emitter = urlDoneEmitter;
  }

  extractUrls(currentUrl){
    return Request({
      headers: {
        'Accept-Language': 'fr-FR,fr;q=0.8,en-US;q=0.5,en;q=0.3',
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
      },
      gzip: true,
      followRedirect: false,
      simple: false,
      resolveWithFullResponse: true,
      url: currentUrl
    })
    .then(response => {
      let newUrls = [];
      let metas = {};
      if (response.statusCode === 200) {
        let $ = Cheerio.load(response.body);
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
        newUrls.push(Url.resolve(currentUrl, response.headers.location));
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

  getInfoCount(doneUrls, todoUrls){
    return { done: Object.keys(doneUrls).length, todo: Object.keys(todoUrls).length };
  }
}

module.exports = Crawler;
