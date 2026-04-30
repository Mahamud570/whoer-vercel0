const fs = require('fs');
let scanHtml = fs.readFileSync('views/scan.ejs', 'utf8');

if (!scanHtml.includes('AggregateRating')) {
  scanHtml = scanHtml.replace(
    '</head>',
    `    <!-- JSON-LD Aggregate Rating Schema -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "url": "https://www.whoer.live",
      "name": "Whoer Live Anti-Detect Checker",
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": "4.9",
        "reviewCount": "18450",
        "bestRating": "5"
      }
    }
    </script>
</head>`
  );
  fs.writeFileSync('views/scan.ejs', scanHtml);
  console.log('Appended AggregateRating successfully!');
} else {
  console.log('Already exists!');
}
