const Crawler = require('./lib');
const Url = require('url');
const argv = require('minimist')(process.argv.slice(2));
const CsvStringify = require('csv-stringify')();
const CsvParse = require('csv-parse/lib/sync');
const fs = require('fs');
const _ = require('lodash');

let parsedUrl = Url.parse(argv._[0]);
let seedUrls = [ { url: argv._[0] } ];

if(argv.seedFile){
  let parsedSeedFile = CsvParse(fs.readFileSync(argv.seedFile), { columns: ['url', 'statusCode'] })
  parsedSeedFile.forEach(function filter(urlData){
    if(urlData.statusCode !== '200'){
      delete urlData.statusCode;
    }
  });
  seedUrls = parsedSeedFile;
}

var csvStream = CsvStringify.pipe(fs.createWriteStream(parsedUrl.hostname + '_urls.csv'));
let webCrawl = new Crawler({ hostname: parsedUrl.hostname, includeSubdomain: argv['include-subdomain'], limit: argv['limit'], concurrency: argv['concurrency'] || 20 }, seedUrls);

webCrawl.promise.then(urls => {
  console.log('Crawl %d urls.', Object.keys(urls).length);
  csvStream.end();
});

webCrawl.emitter.on('url.done', urlData => {
  CsvStringify.write([ urlData.url, urlData.statusCode ]);
});
