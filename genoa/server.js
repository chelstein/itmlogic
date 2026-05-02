const port = process.env.PORT;

if (!port) {
  console.error("NO PORT PROVIDED BY DO");
  process.exit(1);
}

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
