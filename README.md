# Web Crawler
Simple web crawling tool.
## Usage in your project
1. `npm install git+https://github.com/hugopoi/webcrawler.git`

```
const Webcrawler = require('webcrawler/lib');
const Url = require('url');
let seedUrl = 'http://blog.hugopoi.net/';
let parsedUrl = Url.parse(seedUrl);
Webcrawler.crawl({ hostname: parsedUrl.hostname }, [ { url: seedUrl } ])
  .then(urls => {
    console.log(urls);
  })

```

You can display debug messages `DEBUG="webcrawler" node .`

## Command Line Tool Features

* Export all founded URLs to csv file.
* Visit only content text/html content URL

Option Include all subdomains `--include-subdomain`

## Todo list

* Add options & documentation
* Update package.json for command line tool usage
* Make package on npmjs.org
* Add unit test

