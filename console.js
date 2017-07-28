const Webcrawler = require('./lib');
const Url = require('url');
const argv = require('minimist')(process.argv.slice(2));
const Csv = require('csv-stringify')();
const fs = require('fs');

let parsedUrl = Url.parse(argv._[0]);

var csvStream = Csv.pipe(fs.createWriteStream(parsedUrl.hostname + '_urls.csv'));
let webCrawl = Webcrawler.crawl({ hostname: parsedUrl.hostname, includeSubdomain: argv['include-subdomain'], limit: argv['limit'], concurrency: argv['concurrency'] || 20 }, [ { url: argv._[0] } ]);

webCrawl.then(urls => {
  console.log('Crawl %d urls.', urls.length);
  csvStream.end();
});

webCrawl.on('url.done', urlData => {
  Csv.write([ urlData.url, urlData.statusCode ]);
});
