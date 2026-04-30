const fs = require('fs');
let scanHtml = fs.readFileSync('views/scan.ejs', 'utf8');

scanHtml = scanHtml.replace(
  /"price": "0" }    }/g,
  `"price": "0" }, "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": "18450", "bestRating": "5" }    }`
);

fs.writeFileSync('views/scan.ejs', scanHtml);
console.log('Fixed scan.ejs schema again');
