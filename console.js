'use strict';
const Crawler = require('./lib');
const Url = require('url');
const argv = require('minimist')(process.argv.slice(2));
const CsvStringify = require('csv-stringify')();
const PromisePipe = require('promisepipe');
const CsvParse = require('csv-parse/lib/sync');
const fs = require('fs');
const _ = require('lodash');
const moment = require('moment');
const Gauge = require('gauge');

let parsedUrl = Url.parse(argv._[0]);
let seedUrls = [ { url: argv._[0] } ];

if(argv.seedFile){
  // TODO implement a syntax checker on seed files
  let parsedSeedFile = CsvParse(fs.readFileSync(argv.seedFile), { columns: ['url', 'statusCode', 'title', 'metas.robots', 'metas.canonical', 'metas.lang'] })
  seedUrls = parsedSeedFile;
}

var csvStream = CsvStringify.pipe(fs.createWriteStream(parsedUrl.hostname + '_urls.csv'));

function writeUrlDataToCsv(urlData){
  CsvStringify.write([ urlData.url, urlData.statusCode, _.get(urlData,'metas.title', '').trim(), _.get(urlData, 'metas.robots'), _.get(urlData, 'metas.canonical'), _.get(urlData, 'metas.lang')]);
}

if(argv.seedFile){ // This will rewrite done url in csv
  seedUrls.forEach(urlData => {
    if(urlData.statusCode){
      writeUrlDataToCsv(urlData);
    }
  });
}

if(argv.priorityRegExp){
  argv.priorityRegExp = eval(argv.priorityRegExp);
}

let startTime = new Date();

let webCrawl = new Crawler({
  hostname: parsedUrl.hostname,
  includeSubdomain: argv['includeSubdomain'],
  limit: argv['limit'],
  timeout: argv['timeout'],
  concurrency: argv['concurrency'] || 20,
  priorityRegExp: argv.priorityRegExp,
  nofollow: argv.nofollow,
  noindex: argv.noindex,
  useCanonical: argv.useCanonical,
  useSitemap: argv.useSitemap,
  exportTodoUrls: argv.exportTodoUrls,
  headers: argv.headers
}, seedUrls);


let gauge;
if(argv.progress){
  let lastStats = 0, lastCall = new Date(), count = 0, speed = 0, remainingTime;
  if(argv.timeout){
    remainingTime = argv.timeout / 1000;
  }else{
    remainingTime = Infinity;
  }
  gauge = new Gauge(process.stderr);
  let compiledProgressMessage = _.template('crawl <%= hostname %> <%= countDone %>/<%= countTotal %> pq:<%= countHighQueue %>  lq:<%= countLowQueue %> s:<%= speed %> pen:<%= pending %> rt:<%= remainingTime %>');
  webCrawl.emitter.on('progress', counts => {
    if (count++ > (argv.concurrency || 20)) {
      speed = (counts.done - lastStats) / (new Date() - lastCall) * 1000;
      if(argv.timeout){
        remainingTime = moment.duration(moment(startTime).add(argv.timeout, 'milliseconds').diff()).as('seconds');
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
  if(argv.exportTodoUrls){
    _.filter(urls, url => !url.statusCode).forEach(urlData => writeUrlDataToCsv(urlData));
  }
  return PromisePipe(csvStream);
});

webCrawl.emitter.on('url.done', urlData => {
  writeUrlDataToCsv(urlData);
});

if(argv.cleanStop){
  process.on('SIGINT', () => webCrawl.stop());
}
