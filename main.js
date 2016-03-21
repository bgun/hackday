/**
 *
 */
'use strict';

//import pg      from 'pg';

import express from 'express';
import fs      from 'fs';
import pg      from 'pg';
import qs      from 'qs';
import request from 'superagent';
import jsdom   from 'jsdom';

import GoogleLocations  from 'google-locations';

const PORT = 9000;
let server = express();

let jquery = fs.readFileSync("./node_modules/jquery/dist/jquery.js", "utf-8");

let secrets = {};
try {
  secrets = JSON.parse(fs.readFileSync('./secrets.json', 'utf-8'));
} catch(e) {
  throw e;
}

let ZILLOW_KEY      = secrets.ZILLOW_KEY;
let HOTWIRE_KEY     = secrets.HOTWIRE_KEY;
let INSTAGRAM_TOKEN = secrets.INSTAGRAM_TOKEN;
let CONN_STRING     = secrets.CONN_STRING;

let average = function(arr) {
  return arr.reduce((curr, prev) => (curr+prev)) / arr.length;
};

let invert = function(num) {
  // flips a metric, i.e. 83 to 17
  // An example would be from "high price" to "good value", where the higher the price index, the lower the value
  return Math.abs(num - 100);
};

let normalize = function(num, min, max) {
  let norm = (num - min) / (max - min);
  if (norm > 1) norm = 1;
  if (norm < 0) norm = 0;
  return Math.floor(norm * 100);
};


let getAverageHotelRating = function(LL) {
  return new Promise((resolve, reject) => {
    let query = qs.stringify({
      apikey: HOTWIRE_KEY,
      dest: LL.join(','),
      rooms: 1,
      adults: 2,
      children: 0,
      startdate: "04/20/2016",
      enddate: "04/23/2016",
      format: "json"
    });
    let url = "http://api.hotwire.com/v1/search/hotel?"+query;
    console.log(url);
    request
      .get(url)
      .end((err, resp) => {
        if (err) {
          reject(err);
        }
        let json;
        try {
          json = JSON.parse(resp.text);
        } catch(e) {
          reject(e);
        }

        let hotelRatingsArray = json.Result.map(r => (
          parseFloat(r.StarRating)
        ));
        console.log("Got Hotwire results");
        resolve({
          average_rating: average(hotelRatingsArray),
          count: hotelRatingsArray.length
        });
    })
  });
};


let scrapeAreaVibes = function(LL) {
  return new Promise(function(resolve, reject) {
    jsdom.env({
      url: 'http://www.areavibes.com/search-results/?ll='+LL.join('+'),
      src: jquery,
      done: function (err, window) {
        var $ = window.$;
        let score = parseInt($('i.scr').first().text());
        let name  = $('.pc-results li').first().text();
        console.log("Got AreaVibes results");
        resolve({
          name: name,
          score: score
        });
      }
    }); // end jsdom.env
  }); // end promise
};


let getInstagramInfo = function(LL) {
  return new Promise(function(resolve, reject) {
    let query = qs.stringify({
      lat: LL[0],
      lng: LL[1],
      count: 500,
      access_token: INSTAGRAM_TOKEN
    });
    let url = 'https://api.instagram.com/v1/media/search?'+query;
    console.log(url);
    request
      .get(url)
      .end((err, resp) => {
        if (err) {
          reject(err);
        }
        console.log("Got Instagram results");
        resolve({
          count: resp.body.data.length
        });
      });
  });
};


let googleLocations = function(LL) {
  return new Promise((resolve, reject) => {
    var places = new GoogleLocations(secrets.GOOGLE_KEY);
    let params = {
      radius: 2000,
      location: LL,
      type: ['store']
    };
    places.search(params, function(err, response) {
      if (err) {
        throw err;
      }
      let results = response.results;
      console.log("Got Google results");
      let avg_rating = average(results.map(r => r.rating));
      let prices = results.filter(r => (r.price_level ? true : false)).map(r => { return (r.price_level); });
      console.log(prices);
      let avg_price  = average(prices);
      resolve({
        avg_rating: avg_rating,
        avg_price : avg_price
      });
    });
  });
};


let nearbyCrimes = function(LL) {
  return new Promise((resolve, reject) => {
    const RADIUS_METERS = 300;
    pg.connect(CONN_STRING, function(err, client, done) {
      if (err) {
        console.error("Error fetching client from pool", err);
      }
      let query = "SELECT * FROM public.crime WHERE ST_DWithin(Geography(ST_MakePoint(lon, lat)), Geography(ST_MakePoint("+LL[1]+","+LL[0]+")), "+RADIUS_METERS+")";
      console.log("Crime query",query);
      client.query(query, function(err, result) {
        done();
        if (err) {
          reject(err);
        } else {
          console.log(result.rows.length);
          resolve({
            count: result.rows.length
          });
        }
      });
    });
  });
}



let getData = function(LL) {
  //return Promise.resolve(sample_data);
  return Promise.all([
    getAverageHotelRating(LL),
    getInstagramInfo(LL),
    scrapeAreaVibes(LL),
    googleLocations(LL),
    nearbyCrimes(LL)
  ]).then(function(results) {
    let hotel = results[0] || {};
    let insta = results[1] || {};
    let vibes = results[2] || {};
    let googs = results[3] || {};
    let crime = results[4] || {};
    return {
      avg_hotel_rating : hotel.average_rating,
      hotel_count      : hotel.count,
      instagram_count  : insta.count,
      neighborhood_name: vibes.name,
      livability       : vibes.score,
      google_avg_rating: googs.avg_rating,
      google_avg_price : googs.avg_price,
      nearby_crimes    : crime.count
    };
  })
  .catch(err => {
    throw err;
  });
};


let makeScores = function(data) {
  console.log("Making scores!");
  let friendly    = data.livability;
  let interesting = normalize(data.instagram_count, 10, 120);
  let safety1     = normalize(data.avg_hotel_rating, 2.2, 3.7);
  let safety2     = data.nearby_crimes ? invert(normalize(data.nearby_crimes, 1, 50)) : 50;
  let safety      = average([safety1, safety2]);
  let value       = invert(normalize(data.google_avg_price, 1.8, 3.5));

  return {
    friendly    : friendly,
    interesting : interesting,
    safety      : safety,
    value       : value
  };
};


server.get('/data', function(req, res) {
  console.log(req.query);
  if (!req.query.lat || !req.query.lon) {
    throw new Error("No location provided!");
  }
  let lat = req.query.lat;
  let lon = req.query.lon;
  getData([lat, lon])
    .then((resp) => {
      console.log("Got all data", resp);
      res.send({
        lat: lat,
        lon: lon,
        scores: makeScores(resp),
        data: resp
      });
    })
    .catch(err => {
      res.send(err);
    })
});


server.get('/', function(req, res) {
  res.sendFile(__dirname+'/index.html');
});


console.log("Server listening on port "+PORT);
server.listen(PORT);
