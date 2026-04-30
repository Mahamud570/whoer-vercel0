const fs = require('fs');
let scanHtml = fs.readFileSync('views/scan.ejs', 'utf8');

// The WebApp schema ends with ' "price": "0" }    }'
// Let's just find "price": "0" }    }' and append the rating.

scanHtml = scanHtml.replace(
  /"price":\s*"0"\s*\}\s*\}/,
  `"price": "0" }, "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": "18450", "bestRating": "5" } }`
);

fs.writeFileSync('views/scan.ejs', scanHtml);
console.log('Fixed scan.ejs schema');
