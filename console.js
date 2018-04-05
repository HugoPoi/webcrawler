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
  console.log('Crawl %d urls.', urls.length);
  if(argv.exportTodoUrls){
    _.filter(urls, url => !url.statusCode).forEach(urlData => writeUrlDataToCsv(urlData));
  }
  return PromisePipe(csvStream);
});

webCrawl.emitter.on('url.done', urlData => {
  writeUrlDataToCsv(urlData);
});


if(argv.progress){
  const gauge = new Gauge(process.stderr);
  webCrawl.emitter.on('progress', counts => {
    gauge.show('crawl ' + parsedUrl.hostname + ' ' + counts.done + '/' + (counts.todo + counts.done) + ' pq:' + counts.queue + ' lq:' + counts.lowPriorityQueue, counts.done / (counts.todo + counts.done));
  });
}

process.on('SIGINT', () => webCrawl.stop());
