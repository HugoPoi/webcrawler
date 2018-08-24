'use strict';

const RobotsParser = require('robots-parser');
const Url = require('url');
const Request = require('request-promise');
const RequestForStream = require('request');
const StreamSitemapParser = require('stream-sitemap-parser');
const PromisePipe = require('promisepipe');
const Promise = require('bluebird');
const debug = require('debug')('webcrawler:sitemap');
const _ = require('lodash');
const entities = require('entities');
const EventEmitter = require('events');

class SitemapHelpers {

  loadSitemap(sitemapUrl){
    debug('Start loading/parsing sitemap', sitemapUrl);
    let sitemapUrlsToLoad = [];
    let sitemapCurrentType;
    let seedUrls = [];
    let urlCount = 0;
    return PromisePipe(
      RequestForStream({url: sitemapUrl, headers: this.config.headers}),
      StreamSitemapParser.fetch().on('data', data => {
        if(data.type){
          debug('Sitemap type', data.type);
          sitemapCurrentType = data.type;
        } else if(data.loc){
          data.loc = entities.decodeXML(data.loc);
          if(sitemapCurrentType === 'sitemapindex'){
            let newSitemapUrl = Url.resolve(sitemapUrl, data.loc);
            sitemapUrlsToLoad.push(newSitemapUrl);
          }
          if(sitemapCurrentType === 'urlset'){
            urlCount++;
            let payload = {url: data.loc};
            seedUrls.push(payload);
            this.emitter.emit('url.new', payload);
          }
        }
      })
    ).then(() => {
      debug('End parsing sitemap %s add %d urls, found new sitemap', sitemapUrl, urlCount, sitemapUrlsToLoad);
      return [sitemapUrlsToLoad, seedUrls];
    });
  }

  constructor(config, initialSeedUrl){
    this.config = config;
    this.initialSeedUrl = initialSeedUrl;
    this.emitter = new EventEmitter();
  }

  getSitemapUrlsFromRobotsTxt(){
    let parsedInitialUrl = Url.parse(this.initialSeedUrl);
    parsedInitialUrl.pathname = '/robots.txt';
    parsedInitialUrl.hash = null;
    parsedInitialUrl.search = null;
    this.robotsTxtUrl = Url.format(parsedInitialUrl);
    return Request({url: this.robotsTxtUrl, headers: this.config.headers}).then( robotsTxtContent => RobotsParser(this.robotsTxtUrl, robotsTxtContent).getSitemaps())
    .then(sitemapUrls => {
      return sitemapUrls.map(url => Url.resolve(this.initialSeedUrl, url));
    })
  }

}

module.exports = SitemapHelpers;
