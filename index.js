const cheerio = require('cheerio'),
request = require('request'),
url = require('url'),
_ = require('underscore'),
async = require('async'),
fs = require('fs'),
stringify = require('csv-stringify'),
debug = require('debug')('webcrawler');

if (typeof String.prototype.endsWiths !== 'function') {
  String.prototype.endsWiths = function(suffixes) {
    var self = this, endWith = false;
    suffixes.forEach(function(test){
      if(self.indexOf(test, self.length - test.length) !== -1){
        endWith = true;
      }
    });
    return endWith;
  };
}


function getPages(currentUrl, urlsDoneStatus, callback){
  var urlsDone = [];
  request({
    headers: {
      'Accept-Language': 'fr-FR,fr;q=0.8,en-US;q=0.5,en;q=0.3',
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
    },
    gzip: true,
    followRedirect: function(response){
      urlsDone.push({url: currentUrl, statusCode: response.statusCode });
      var newUrl = url.resolve(currentUrl, response.headers.location);
      if(urls[newUrl] && urls[newUrl].statusCode){
        return false;
      }else{
        currentUrl = newUrl;
        return true;
      }
    },
    url: currentUrl
  }, function (error, response, body) {
    if(error){
      urlsDone.push({url: currentUrl, statusCode: error.message });
    }else{
      urlsDone.push({url: currentUrl, statusCode: response.statusCode });
    }
    if (!error && response.statusCode === 200) {
      var $ = cheerio.load(body);
      var urls = [];
      $('a').each(function(){
        var href = $(this).attr('href');
        if(href){
          urls.push(url.resolve(currentUrl, href));
        }
      });
      return callback(null, urls, urlsDone);
    }
    if(!error && (response.statusCode === 302 || response.statusCode === 301)){
      debug('Info return 3xx code on ', currentUrl);
    }else{
      console.error('Get error for ' + currentUrl);
      debug('Error details', error);
    }
    return callback(null, [], urlsDone);
  });
};

var startUrlInfos = url.parse(process.argv[2]);

var urls = {};
urls[process.argv[2]] = {};

debug('Seed', urls);
var toCsv = stringify();
toCsv.pipe(fs.createWriteStream(startUrlInfos.hostname + '_urls.csv'));

function getInfoCount(){
  return _.chain(urls).values().countBy(function(urlData){
    if(urlData.beeingProcessed && !urlData.statusCode){
      return 'beeingProcessed';
    }
    if(urlData.statusCode){
      return 'done';
    }
    if(!urlData.statusCode && !urlData.beeingProcessed){
      return 'todo';
    }
    return 'dafuck';
  }).value();
}

async.whilst(function(){
  return !!_.findKey(urls, function(urlData){
    return !urlData.statusCode;
  });
}, function(callback){
  debug('Start crawl batch');

  var urlsToDo = _.pick(urls, function(data, key){
    return !urls[key].statusCode && !urls[key].beeingProcessed;
  });

  async.forEachOfLimit(urlsToDo, 20, function(urlData, urlToTreat, done){
    if(!urlData.statusCode && !urls[urlToTreat].beeingProcessed){
      urls[urlToTreat].beeingProcessed = true;
      getPages(urlToTreat, urls, function(err, newUrls, urlsDone){
        if(!err){
          urlsDone.forEach(function(update){
            urls[update.url] = urls[update.url] || {};
            urls[update.url].statusCode = update.statusCode;
            if(update.statusCode === 200){
              toCsv.write([update.url, update.statusCode]);
            }
          });
          newUrls.forEach(function(newUrl){
            var newUrlInfos = url.parse(newUrl);
            debug(newUrlInfos.hostname, startUrlInfos.hostname);
            if(newUrlInfos.hostname === startUrlInfos.hostname && !newUrlInfos.pathname.endsWiths(['.jpg', '.png', '.pdf', '.mp4', '.mp3', '.zip', '.gif', '.rar'])){
              delete newUrlInfos.hash;
              //delete newUrlInfos.search;
              var addUrl = url.format(newUrlInfos);
              if(!urls[addUrl]){
                urls[addUrl] = {};
              }
            }
          });
        }
        async.nextTick(function(){
          console.log('Crawling status ', getInfoCount());
          done(err);
        });
      });
    }else{
      async.nextTick(function(){
        done();
      });
    }
  }, function(err){
    debug('Finish found %d urls', _.keys(_.pick(urls, function(key){ return !urls[key]; })).length);
    callback(err);
  });
}, function(err){
  if(err){
    console.error(err);
  }
  debug('Operation done with total url %d', _.keys(urls).length);
  toCsv.end();
});
