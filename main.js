/**
 *
 */
'use strict';

//import pg      from 'pg';

import express from 'express';
import fs      from 'fs';
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
    request
      .get("http://api.hotwire.com/v1/search/hotel")
      .query({
        apikey: HOTWIRE_KEY,
        dest: LL.join(','),
        rooms: 1,
        adults: 2,
        children: 0,
        startdate: "04/20/2016",
        enddate: "04/23/2016",
        format: "json"
      })
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
    request
      .get('https://api.instagram.com/v1/media/search')
      .query({
        lat: LL[0],
        lng: LL[1],
        count: 100,
        access_token: INSTAGRAM_TOKEN
      })
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
      radius: 5000,
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
      let prices = results.map(r => { return (r.price_level || 2); });
      console.log(prices);
      let avg_price  = average(prices);
      resolve({
        avg_rating: avg_rating,
        avg_price : avg_price
      });
    });
  });
};


let sample_data = {
  "avg_hotel_rating": 3.37546468401487,
  "hotel_count": 269,
  "instagram_count": 100,
  "neighborhood_name": "West Village, New York, NY",
  "livability": 83,
  "google_avg_rating": 4.03,
  "google_avg_price": 2.5
};

let getData = function(LL) {
  //return Promise.resolve(sample_data);
  return Promise.all([
    getAverageHotelRating(LL),
    getInstagramInfo(LL),
    scrapeAreaVibes(LL),
    googleLocations(LL)
  ]).then(function(results) {
    let hotel = results[0] || {};
    let insta = results[1] || {};
    let vibes = results[2] || {};
    let googs = results[3] || {};
    return {
      avg_hotel_rating : hotel.average_rating,
      hotel_count      : hotel.count,
      instagram_count  : insta.count,
      neighborhood_name: vibes.name,
      livability       : vibes.score,
      google_avg_rating: googs.avg_rating,
      google_avg_price : googs.avg_price
    };
  })
  .catch(err => {
    throw err;
  });
};


let makeScores = function(data) {
  console.log("Making scores!");
  let friendly    = data.livability;
  let interesting = normalize(data.instagram_count, 10, 110);
  let safety      = normalize(data.avg_hotel_rating, 2, 5);
  let value       = invert(normalize(data.google_avg_price, 1, 3));
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
      throw err;
    })
});


server.get('/', function(req, res) {
  res.sendFile(__dirname+'/index.html');
});


console.log("Server listening on port "+PORT);
server.listen(PORT);

/*
pg.connect(CONN_STRING, function(err, client, done) {
  if (err) {
    console.error("Error fetching client from pool", err);
  }
  let query = "SELECT * FROM " + env.REGION_TABLE;
  client.query(query, function(err, result) {
    done();
    if (err) {
      ResponseManager.sendJsonResponse(res, err);
    } else {
      ResponseManager.sendJsonResponse(res, null, "regionsets", result.rows);
    }
  });
});
*/