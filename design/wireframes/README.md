# Corum Wireframes

These wireframes are a browser-based React/Babel export. Run them through a local web server so the HTML file can load the sibling `.jsx` and CSS files correctly.

From the repository root:

```powershell
npm run wireframes
```

Then open the URL printed in the terminal. By default it is:

```text
http://127.0.0.1:8000/Corum%20Wireframes.html
```

If port `8000` is already in use, the script will try the next available port. To request a specific starting port:

```powershell
$env:PORT = "8080"
npm run wireframes
```

Press `Ctrl+C` in the terminal to stop the server.
