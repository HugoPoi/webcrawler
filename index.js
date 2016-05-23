var cheerio = require('cheerio'),
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


function getPages(currentUrl, callback){
  var urlsDone = [];
  urlsDone.push(currentUrl);
  request({ followRedirect: function(response){
    currentUrl = url.resolve(currentUrl, response.headers.location);
    urlsDone.push(currentUrl);
    return true;
  }, url: currentUrl }, function (error, response, body) {
    if (!error && response.statusCode === 200) {
      var $ = cheerio.load(body);
      var urls = [];
      $('a').each(function(){
        var href = $(this).attr('href');
        if(href){
          urls.push(url.resolve(currentUrl, href));
        }
      });
      callback(null, urls, urlsDone);
    }
  });
};

var startUrlInfos = url.parse(process.argv[2]);

var urls = {};
urls[process.argv[2]] = false;


var toCsv = stringify();
toCsv.pipe(fs.createWriteStream(startUrlInfos.hostname + '_urls.csv'));

async.whilst(function(){
  return !!_.findKey(urls, function(done){
    return !done;
  });
},function(callback){
  debug('Start crawl batch');
  async.forEachOfLimit(_.pick(urls, function(key){ return !urls[key]; }), 8, function(hasBeenDone, urlToTreat, done){
    if(!hasBeenDone){
      debug('GET %s', urlToTreat);
      async.nextTick(function(){
      getPages(urlToTreat, function(err, newUrls, urlsDone){
        if(!err){
          urlsDone.forEach(function(url){
            urls[url] = true;
            toCsv.write([url]);
          });
          newUrls.forEach(function(newUrl){
            var newUrlInfos = url.parse(newUrl);
            if(newUrlInfos.hostname === startUrlInfos.hostname && !newUrlInfos.pathname.endsWiths(['.jpg', '.png', '.pdf', '.mp4', '.mp3', '.zip', '.gif'])){
              delete newUrlInfos.hash;
              //delete newUrlInfos.search;
              var addUrl = url.format(newUrlInfos);
              if(!urls[addUrl]){
                urls[addUrl] = false;
              }
            }
          });
        }
        done();
      });
      })
    }else{
      done();
    }
  }, function(err){
    debug('Finish found %d urls', _.keys(_.pick(urls, function(key){ return !urls[key]; })).length);
    callback();
  });
}, function(){
  debug('Operation done with total url %d', _.keys(urls).length);
  toCsv.end();
  //JSON.stringify(urls);
});
