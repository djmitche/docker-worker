/**
The docker worker schema situation is not as easy as the queue or other http
services. The worker consumes mostly from a private state pulling from trusted
resources. That and the fact that we could have thousands of workers makes
auto pushing schema's tricky. For now this script does the uploads manually.
*/

var co = require('co');
var aws = require('aws-sdk-promise');

var config = require('../lib/config')();

co(function* () {
  var s3 = new aws.S3({
    region: config.schema.region,
    params: {
      Bucket: config.schema.bucket
    }
  });

  function* put(path, object) {
    var key = config.schema.path + path;
    console.log('uploading: %s', key);
    return yield s3.putObject({
      Key: key,
      ContentType: 'application/json',
      Body: new Buffer(JSON.stringify(object, null, 2))
    }).promise();
  }

  yield [
    put('payload.json', require('../schemas/payload.json')),
    put('result.json', require('../schemas/result.json')),
  ];

})(function(err) {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(
    'Done uploading schemas to s3://%s%s',
    config.schema.bucket, config.schema.path
  );
});
