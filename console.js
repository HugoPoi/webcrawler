const Crawler = require('./lib');
const Url = require('url');
const argv = require('minimist')(process.argv.slice(2));
const CsvStringify = require('csv-stringify')();
const PromisePipe = require('promisepipe');
const CsvParse = require('csv-parse/lib/sync');
const fs = require('fs');
const _ = require('lodash');
const Gauge = require('gauge');

let parsedUrl = Url.parse(argv._[0]);
let seedUrls = [ { url: argv._[0] } ];

if(argv.seedFile){
  // TODO implement a syntax checker on seed files
  let parsedSeedFile = CsvParse(fs.readFileSync(argv.seedFile), { columns: ['url', 'statusCode', 'title', 'metas.robots', 'metas.canonical'] })
  seedUrls = parsedSeedFile;
}

var csvStream = CsvStringify.pipe(fs.createWriteStream(parsedUrl.hostname + '_urls.csv'));

function writeUrlDataToCsv(urlData){
  CsvStringify.write([ urlData.url, urlData.statusCode, _.get(urlData,'metas.title', '').trim(), _.get(urlData, 'metas.robots'), _.get(urlData, 'metas.canonical') ]);
}

if(argv.seedFile){ // This will rewrite done url in csv
  seedUrls.forEach(urlData => {
    if(urlData.statusCode){
      writeUrlDataToCsv(urlData);
    }
  });
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
  exportTodoUrls: argv.exportTodoUrls
}, seedUrls);

webCrawl.promise.then(urls => {
  console.log('Crawl %d urls. average speed: %d, totalTime: %d', urls.length, urls.length / (new Date() - startTime) * 1000,  (new Date() - startTime) / 1000);
  if(argv.exportTodoUrls){
    _.filter(urls, url => !url.statusCode).forEach(urlData => writeUrlDataToCsv(urlData));
  }
  return PromisePipe(csvStream);
});

webCrawl.emitter.on('url.done', urlData => {
  writeUrlDataToCsv(urlData);
});


if(argv.progress){
  let lastStats = 0, lastCall = new Date(), count = 0, speed = 0, remainingTime = Infinity;
  const gauge = new Gauge(process.stderr);
  webCrawl.emitter.on('progress', counts => {
    if(count++ > (counts.todo / ( argv.concurrency || 20) ) ){
      speed = (counts.done - lastStats) / (new Date() - lastCall) * 1000;
      remainingTime = counts.todo / speed;
      count = 0;
      lastStats = counts.done;
      lastCall = new Date();
    }
    gauge.show('crawl ' + parsedUrl.hostname + ' ' + counts.done + '/' + (counts.todo + counts.done) + ' pq:' + counts.queue + ' lq:' + counts.lowPriorityQueue + ' s:' + speed + ' rt:' + remainingTime, counts.done / (counts.todo + counts.done));
  });
}

process.on('SIGINT', () => webCrawl.stop());
