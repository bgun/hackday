/**
 *
 */
'use strict';

//import pg      from 'pg';

import express from 'express';
import fs      from 'fs';
import request from 'superagent';
import jsdom   from 'jsdom';

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
        let score = $('i.scr').first().text();
        let name  = $('.pc-results li').first().text();
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
        resolve({
          count: resp.body.data.length
        });
      });
  });
};



let doStuff = function(LL) {
  return Promise.all([
    getAverageHotelRating(LL),
    getInstagramInfo(LL),
    scrapeAreaVibes(LL)
  ]).then(function(results) {
    let hotel = results[0] || {};
    let insta = results[1] || {};
    let vibes = results[2] || {};
    return {
      avg_hotel_rating : hotel.average_rating,
      hotel_count      : hotel.count,
      instagram_count  : insta.count,
      neighborhood_name: vibes.name,
      livability       : vibes.score
    };
  })
  .catch(err => {
    throw err;
  });
};

server.get('/', function(req, res) {
  console.log(req.query);
  let lat = req.query.lat;
  let lon = req.query.lon;
  doStuff([lat, lon])
    .then((resp) => {
      res.send({
        lat: lat,
        lon: lon,
        meta: resp
      });
    })
    .catch(err => {
      throw err;
    })
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