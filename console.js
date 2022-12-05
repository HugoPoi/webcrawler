#!/usr/bin/env node
'use strict';
const Crawler = require('./lib');
const Url = require('url');
const parseArgs = require('minimist');
const CsvStringify = require('csv-stringify');
const PromisePipe = require('promisepipe');
// TODO use async for csv-parse
const CsvParse = require('csv-parse/lib/sync');
const fs = require('fs');
const _ = require('lodash');
const moment = require('moment');
const Gauge = require('gauge');
const sade = require('sade');
const argsSadeParser = sade('webcrawler [urls]');

const csvConfig = {
  header: true,
  quoted_string: true,
  columns: ['url', 'statusCode', 'metas.title', 'metas.robots', 'metas.canonical', 'metas.lang', 'parent.url']
};

argsSadeParser
  .version(require('./package').version)
  .describe('Crawl the given url as the starting point.')
  .option('-p, --progress', 'Display progress during crawling', false)
  .example('https://blog.hugopoi.net --progress')
  .option('-c, --concurrency', 'specify the number of concurrent http queries running in parallel', 20)
  .option('--priority-regexp', 'match urls will be push at the top of the crawling queue')
  .option('--seed-file', 'take a csv as url seeds to crawl')
  .option('--output-with-todo-urls', 'Keep the undone urls to continue the crawl later')
  .option('--include-subdomain', 'continue and follow HTTP redirect to subdomains', false)
  .option('--force-no-follow', 'Ignore nofollow html markup and continue crawling', false)
  .option('--force-no-index', 'Ignore noindex html markup and continue crawling', false)
  .action((url, opts) => {
    const parsedUrl = Url.parse(url);
    let seedUrls = _.chain([url]).concat(opts._).map((url) => ({url})).value();

    // TODO should be either --seed-file or urls not both
    if(opts['seed-file']){
      // TODO implement a syntax checker on seed files
      let parsedSeedFile = CsvParse(fs.readFileSync(opts['seed-file']), csvConfig);
      seedUrls = parsedSeedFile;
    }

    const csvWriter = CsvStringify(csvConfig);
    const csvStream = csvWriter.pipe(fs.createWriteStream(parsedUrl.hostname + '_urls.csv'));

    if(opts['seed-file']){
    // This will rewrite done url in csv
      seedUrls.forEach(urlData => {
        if(urlData.statusCode){
          csvWriter.write(urlData);
        }
      });
    }

    const startTime = new Date();

    let webCrawl = new Crawler({
      hostname: parsedUrl.hostname,
      includeSubdomain: opts['include-subdomain'],
      limit: opts.limit,
      timeout: opts.timeout,
      concurrency: opts.concurrency,
      // TODO security better protection on eval
      priorityRegExp: opts['priority-regexp'] ? eval(opts['priority-regexp']) : undefined,
      forceNoFollow: opts['force-no-follow'],
      forceNoIndex: opts['force-no-index'],
      useCanonical: opts.useCanonical,
      useSitemap: opts.useSitemap,
      exportTodoUrls: opts.exportTodoUrls,
      headers: opts.headers
    }, seedUrls);


    let gauge;
    if(opts.progress){
      let lastStats = 0, lastCall = new Date(), count = 0, speed = 0, remainingTime;
      if(opts.timeout){
        remainingTime = opts.timeout / 1000;
      }else{
        remainingTime = Infinity;
      }
      gauge = new Gauge(process.stderr);
      let compiledProgressMessage = _.template('crawl <%= hostname %> <%= countDone %>/<%= countTotal %> pq:<%= countHighQueue %>  lq:<%= countLowQueue %> s:<%= speed %> pen:<%= pending %> rt:<%= remainingTime %>');
      webCrawl.emitter.on('progress', counts => {
        if (count++ > (opts.concurrency || 20)) {
          speed = (counts.done - lastStats) / (new Date() - lastCall) * 1000;
          if(opts.timeout){
            remainingTime = moment.duration(moment(startTime).add(opts.timeout, 'milliseconds').diff()).as('seconds');
          }else{
            remainingTime = counts.todo / speed;
          }
          count = 0;
          lastStats = counts.done;
          lastCall = new Date();
        }
        gauge.show(compiledProgressMessage({
          hostname: parsedUrl.hostname,
          countDone: counts.done,
          countTotal: counts.todo + counts.done,
          countHighQueue: counts.queue,
          countLowQueue: counts.lowPriorityQueue,
          speed: speed.toFixed(2),
          remainingTime: moment.duration(remainingTime, 'seconds').humanize(),
          pending: counts.pending,
        }), counts.done / (counts.todo + counts.done));
      });
    }

    webCrawl.start().then(urls => {
      if(gauge){
        gauge.disable();
      }
      let averageSpeed = urls.length / (new Date() - startTime) * 1000;
      let totalTime =  (new Date() - startTime) / 1000;
      console.log('crawled %d urls. average speed: %d urls/s, totalTime: %ds', urls.length, averageSpeed.toFixed(2), totalTime.toFixed(0));
      if(opts.exportTodoUrls){
        _.filter(urls, url => !url.statusCode).forEach(urlData => csvWriter.write(urlData));
      }
      return PromisePipe(csvStream);
    });

    webCrawl.emitter.on('url.done', urlData => {
      csvWriter.write(urlData);
    });

    if(opts.cleanStop){
      process.on('SIGINT', () => webCrawl.stop());
    }
  });

argsSadeParser.parse(process.argv);
