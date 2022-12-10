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
const crypto = require('crypto');
const JSONStream = require('jsonstream2');

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
  .example('--seedfile blog.hugopoi.net_urls.csv --progress')
  .option('--include-subdomain', 'continue and follow HTTP redirect to subdomains', false)
  .option('--ignore-no-follow', 'Ignore nofollow html markup and continue crawling', false)
  .option('--ignore-no-index', 'Ignore noindex html markup and continue crawling', false)
  .option('--force-exit', 'Force exit when processus receive SIGINT via Ctrl+C', false)
  .option('--save-files', 'Alpha feature: Save html files crawled named sha256 of the content itself')
  .option('--output-format', 'Output format of the urls list: csv|json', 'csv')
  .action((url, opts) => {
    let seedUrls;
    if (url) {
      seedUrls = _.chain([url]).concat(opts._).map((url) => ({url})).value();
    } else if(opts['seed-file']) {
      // TODO implement a syntax checker on seed files and take care of json file too
      const parsedSeedFile = CsvParse(fs.readFileSync(opts['seed-file']), csvConfig);
      seedUrls = parsedSeedFile;
    } else {
      throw new Error('Need a starting URL or a seedfile')
    }
    const parsedUrl = Url.parse(seedUrls[0].url);

    const outputWriter = opts['output-format'] === 'csv' ? CsvStringify(csvConfig) : JSONStream.stringify();
    const outputFile = fs.createWriteStream(parsedUrl.hostname + `_urls.${opts['output-format']}`);
    const outputStream = outputWriter.pipe(outputFile);

    if(opts['seed-file']){
    // This will rewrite done url in csv
      seedUrls.forEach(urlData => {
        if(urlData.statusCode){
          outputWriter.write(urlData);
        }
      });
    }

    const startTime = new Date();

    const webCrawl = new Crawler({
      hostname: parsedUrl.hostname,
      includeSubdomain: opts['include-subdomain'],
      limit: opts.limit,
      timeout: opts.timeout,
      concurrency: opts.concurrency,
      // TODO security better protection on eval
      priorityRegExp: opts['priority-regexp'] ? new RegExp(opts['priority-regexp'], 'i') : undefined,
      forceNoFollow: opts['ignore-no-follow'],
      forceNoIndex: opts['ignore-no-index'],
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

    webCrawl.start().then(({doneUrls, todoUrls}) => {
      if(gauge){
        gauge.disable();
      }
      let averageSpeed = doneUrls.length / (new Date() - startTime) * 1000;
      let totalTime =  (new Date() - startTime) / 1000;
      console.error('crawled %d urls. average speed: %d urls/s, totalTime: %ds', doneUrls.length, averageSpeed.toFixed(2), totalTime.toFixed(0));
      todoUrls.forEach(urlData => outputWriter.write(urlData));
      outputWriter.end();
      return PromisePipe(outputStream);
    });

    webCrawl.emitter.on('url.done', (urlData, response) => {
      outputWriter.write(urlData);
      if ( opts['save-files'] ) {
        const hash = crypto.createHash('sha256').update(response.body).digest('hex');
        fs.writeFileSync(hash + '.html', response.body)
      }
    });

    if(!opts['force-exit']){
      process.on('SIGINT', () => webCrawl.stop());
    }
  });

argsSadeParser.parse(process.argv);
