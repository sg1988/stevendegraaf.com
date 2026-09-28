# stevendegraaf.com

Personal site of Steven de Graaf — Project Engineer at Tata Steel, hydraulics & pneumatics specialist, builds with AI.

Static site, no build step and no third-party requests at runtime:

- `index.html`: the page
- `assets/css/site.css`: styles
- `assets/js/main.js`: motion and the WebGL scene (pipes → neural network)
- `assets/js/three.module.min.js`: [three.js](https://threejs.org) r160 (MIT), vendored
- `assets/fonts/`: Inter Tight and JetBrains Mono (SIL OFL), self-hosted

Run locally:

```bash
python -m http.server 8000
```

Hosted on GitHub Pages with the custom domain in `CNAME`.
