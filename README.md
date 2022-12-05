# Web Crawler
Simple web crawling tool

* Crawl a entire website with just a start url
* Output the result as a CSV file
* Can start and stop from the CSV file (need doc)
* Fast

## Usage in your project as a lib
1. `npm install git+https://github.com/hugopoi/webcrawler.git`

```javascript
const Webcrawler = require('webcrawler');
const Url = require('url');
let seedUrl = 'http://blog.hugopoi.net/';
let parsedUrl = Url.parse(seedUrl);
let webCrawl = new Crawler({
  hostname: parsedUrl.hostname, // Limit crawl to this domain name
  includeSubdomain: false, // Crawl subdomain
  limit: 10000, // Max urls to crawl
  concurrency: 20, // Concurent http call
  priorityRegExp: false, // String to prioritize during crawl, if in
title, url or link text
  nofollow: false, // Ignore urls on nofollow page
  noindex: false // Ignore urls on noindex page
}, [ { url: seedUrl } ]);

webCrawl.promise.then(urls => {
  console.log('Crawl %d urls.', urls.length);
});

webCrawl.emitter.on('url.done', urlData => {
  console.log(urlData.url);
});
```

You can display debug messages `DEBUG="webcrawler" node .`

## Command Line Tool Features

* Export all founded URLs to csv file.
* Visit only content text/html content URL

Option Include all subdomains `--include-subdomain`
Option Limit `--limit 10`

## Todo list

* Add options & documentation
* Update package.json for command line tool usage
* Make package on npmjs.org
* Add unit test
* Limit option on already checked urls
