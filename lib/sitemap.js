'use strict';

const RobotsParser = require('robots-parser');
const Url = require('url');
const Request = require('request-promise');
const StreamSitemapParser = require('stream-sitemap-parser');
const PromisePipe = require('promisepipe');
const Promise = require('bluebird');
const debug = require('debug')('webcrawler:sitemap');
const _ = require('lodash');
const entities = require('entities');
const EventEmitter = require('events');
const PQueue = require('p-queue');

class SitemapCrawler {

  loadSitemap(sitemapUrl){
    sitemapUrl = Url.resolve(this.initialSeedUrl, entities.decodeXML(sitemapUrl));
    debug('Start loading/parsing sitemap', sitemapUrl);
    let sitemapUrlsToLoad = [];
    let sitemapCurrentType;
    let urlCount = 0;
    return PromisePipe(
      Request({url: sitemapUrl, headers: this.config.headers}),
      StreamSitemapParser.fetch().on('data', data => {
        if(data.type){
          debug('Sitemap type', data.type);
          sitemapCurrentType = data.type;
        } else if(data.loc){
          if(sitemapCurrentType === 'sitemapindex'){
            sitemapUrlsToLoad.push(data.loc);
          }
          if(sitemapCurrentType === 'urlset'){
            urlCount++;
            let payload = {url: data.loc};
            this.seedUrls.push(payload);
            this.emitter.emit('url.new', payload);
          }
        }
      })
    ).then(() => {
      this.done++;
      this.emitter.emit('progress', this.getInfoCount());
      debug('End parsing sitemap %s add %d urls, found new sitemap', sitemapUrl, urlCount, sitemapUrlsToLoad);
      sitemapUrlsToLoad.forEach(sitemapUrl => this.queue.add(() => this.loadSitemap(sitemapUrl)));
    });
  }

  constructor(initialSeedUrl, config){
    this.initialSeedUrl = initialSeedUrl;
    this.config = config;
    this.seedUrls = [];
    this.queue = new PQueue({ concurrency: config.concurrency || 20 });
    this.emitter = new EventEmitter();
    this.done = 0;

    let parsedInitialUrl = Url.parse(initialSeedUrl);
    parsedInitialUrl.pathname = '/robots.txt';
    parsedInitialUrl.hash = null;
    parsedInitialUrl.search = null;
    this.robotsTxtUrl = Url.format(parsedInitialUrl);

  }

  start(){
    return Request({url: this.robotsTxtUrl, headers: this.config.headers}).then( robotsTxtContent => RobotsParser(this.robotsTxtUrl, robotsTxtContent).getSitemaps())
      .then(sitemapUrls => {
        sitemapUrls.forEach(sitemapUrl => this.queue.add(() => this.loadSitemap(sitemapUrl)));
        return this.queue.onIdle();
      })
      .then(() => {
        debug('queue onIdle, crawling sitemap done.');
        return this.seedUrls;
      });
  }

  getInfoCount(){
    return {
      done: this.done,
      todo: this.queue.queue._queue.length,
      urlsFound: this.seedUrls.length,
    };
  }

}

module.exports = SitemapCrawler;
