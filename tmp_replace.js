let fs = require('fs');
let f = fs.readFileSync('views/scan.ejs', 'utf8');

f = f.replace(
    '</head><body>',
    '</head><body><div id="liquid-ether-bg" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:-1;opacity:0.35;"></div>'
);

f = f.replace(
    '<script src="/js/privacy-engine.js"></script>',
    '<script src="/js/privacy-engine.js"></script>\n<script defer src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>\n<script defer src="/js/liquid-ether.js"></script>\n<script>\nwindow.addEventListener("load", () => {\n  setTimeout(() => {\n    if (window.LiquidEther && document.getElementById("liquid-ether-bg")) {\n      window.LiquidEther(document.getElementById("liquid-ether-bg"), {\n        colors: ["#0b001a", "#ff1a4a", "#1a0033"],\n        autoIntensity: 1.5,\n        resolution: 0.35\n      });\n    }\n  }, 200);\n});\n</script>'
);

fs.writeFileSync('views/scan.ejs', f);
console.log('replaced successfully');
