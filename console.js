const Webcrawler = require('./lib');
const Url = require('url');
const argv = require('minimist')(process.argv.slice(2));
const Csv = require('csv-stringify')();
const fs = require('fs');

let parsedUrl = Url.parse(argv._[0]);
Webcrawler.crawl({ hostname: parsedUrl.hostname, includeSubdomain: argv['include-subdomain'], limit: argv['limit'] }, [ { url: argv._[0] } ])
  .then(urls => {
    Csv.pipe(fs.createWriteStream(parsedUrl.hostname + '_urls.csv'));
    urls.forEach(url => Csv.write([ url.url, url.statusCode ]) );
  })
