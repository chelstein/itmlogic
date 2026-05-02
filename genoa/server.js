require('http')
  .createServer((req, res) => {
    if (req.url === '/healthz') {
      res.end('ok');
    } else {
      res.end('booting');
    }
  })
  .listen(process.env.PORT || 8080, () => {
    console.log("MINIMAL SERVER UP");
  });
