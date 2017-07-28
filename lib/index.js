const Cheerio = require('cheerio');
const Request = require('request-promise');
const Url = require('url');
const _ = require('lodash');
const debug = require('debug')('webcrawler');
const Promise = require('bluebird');
const Tldjs = require('tldjs');
const EventEmitter = require('events');

class UrlDoneEmitter extends EventEmitter {}


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


function extractUrls(currentUrl){
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
    if (response.statusCode === 200) {
      let $ = Cheerio.load(response.body);
      $('a').each(function(){
        var href = $(this).attr('href');
        if(href){
          newUrls.push(Url.resolve(currentUrl, href));
        }
      });
    }
    else if (response.statusCode === 301 || response.statusCode === 302) {
      newUrls.push(Url.resolve(currentUrl, response.headers.location));
    }
    else{
      console.error('Response code %d', response.statusCode, response.body);
    }

    return [newUrls, response];
  });
};

module.exports.crawl = function crawl(config, urls){

  const urlDoneEmitter = new UrlDoneEmitter();

  function _crawl(){
    let todoUrls = _.filter(urls, urlData => {
      return !urlData.statusCode;
    });
    return Promise.map(todoUrls, urlData => {
      debug('Start extract urls on %s', urlData.url);
      return extractUrls(urlData.url)
        .then(([newUrls, response]) => {
          urlData.statusCode = response.statusCode;
          urlDoneEmitter.emit('url.done', urlData);
          let urlsToMerge = _.chain(newUrls)
            .map( url => Url.parse(url) )
            .filter(url => {// TODO maybe this can be overide by config ?
              if(!config.includeSubdomain){
                return url.hostname === config.hostname && !url.pathname.endsWiths(['.jpg', '.png', '.pdf', '.mp4', '.mp3', '.zip', '.gif', '.rar']);
              }else{
                return Tldjs.getDomain(url.hostname) === Tldjs.getDomain(config.hostname) && !url.pathname.endsWiths(['.jpg', '.png', '.pdf', '.mp4', '.mp3', '.zip', '.gif', '.rar']);
              }
            })
            .map(url => {
              delete url.hash; // TODO do this as option and add possiblity to ignore certain request params
              return Url.format(url);
            })
            .uniq()
            .filter(url => {
              return !_.find(urls, { url: url });
            })
            .map(url => {
              return { url: url };
            })
            .value();
          urls = urls.concat(urlsToMerge);
        })
        .catch(error => { // TODO catch only network error
          urlData.statusCode = 523;
        });
    }, { concurrency: config.concurrency || 20 })
      .then(function(){
        let todoUrls = _.filter(urls, urlData => {
          return !urlData.statusCode;
        });
        console.log('Webcrawl status', getInfoCount(urls));
        if(config.limit && urls.length >= config.limit ){
          return urls;
        }
        if(todoUrls.length > 0){
          return _crawl();
        }else{
          return urls;
        }
      });
  };
  let promise = _crawl();
  promise.on = urlDoneEmitter.on.bind(urlDoneEmitter);
  return promise;
}

function getInfoCount(urls){
  return _.chain(urls).countBy(function(urlData){
    if(urlData.statusCode){
      return 'done';
    }else{
      return 'todo';
    }
  }).value();
}
