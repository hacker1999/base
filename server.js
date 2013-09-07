var base = require('./lib/base');

var app = new base.HttpServer({
    port: 8080, 
    webRoot: './www'
});

app.get('/', function(req, res) {
    res.end('Home page');
});

app.get(/^\/posts\/([1-9]\d*)\/?$/, function(req, res, id) {
    res.end('Load post #' + id);
});

/* 
app.post, app.put, app.delete имеют общий синтаксис с app.get
app.addRoute(method, pattern, callback);
*/
app.run();