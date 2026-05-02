const port = 8080;

require('http')
  .createServer((req, res) => {
    if (req.url === '/healthz') {
      res.end('ok');
    } else {
      res.end('booting');
    }
  })
  .listen(port, () => {
    console.log("BOUND TO PORT:", port);
  });
