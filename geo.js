import fs from 'fs';

let geonames = fs.readFileSync('./cities15000.txt', 'utf-8');

let rows = geonames.split('\n').map(r => r.split('\t'));

console.log("Cities with > 15000 population: ", rows.length);

rows = rows.map((row, index) => ({
  index       : index,
  geonames_id : row[0],
  name        : row[1],
  latitude    : row[4],
  longitude   : row[5],
  country_code: row[8],
  state_code  : row[10],
  population  : row[14],
  timezone    : row[17]
}));

// NYC
// console.log(rows[21811]);

let usa = rows.filter(row => {
  return row.country_code === 'US' && row.population > 50000;
});
console.log("US cities with > 50000 population: ", usa.length);
