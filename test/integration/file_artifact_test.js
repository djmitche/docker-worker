import assert from 'assert';
import getArtifact from './helper/get_artifact';
import cmd from './helper/cmd';
import expires from './helper/expires';
import testworker from '../post_task';
import TestWorker from '../testworker';
import DockerWorker from '../dockerworker';
import iptables from 'iptables';

suite('artifact extration tests', () => {
  teardown(() => {
    iptables.deleteRule({
      chain: 'OUTPUT',
      target: 'REJECT',
      protocol: 'tcp',
      dport: 443,
      sudo: true
    });
  });

  test('extract artifact', async () => {
    let result = await testworker({
      payload: {
        image: 'taskcluster/test-ubuntu',
        command: cmd(
          'mkdir /artifacts/',
          'echo "xfoo" > /artifacts/xfoo.txt',
          'echo "bar" > /artifacts/bar.txt',
          'ls /artifacts'
        ),
        features: {
          localLiveLog: false
        },
        artifacts: {
          'public/xfoo': {
            type: 'file',
            expires: expires(),
            path: '/artifacts/xfoo.txt'
          },

          'public/bar': {
            type: 'file',
            expires: expires(),
            path: '/artifacts/bar.txt'
          }
        },
        maxRunTime: 5 * 60
      }
    });

    // Get task specific results
    assert.equal(result.run.state, 'completed', 'task should be successful');
    assert.equal(result.run.reasonResolved, 'completed', 'task should be successful');

    assert.deepEqual(
      Object.keys(result.artifacts).sort(), ['public/xfoo', 'public/bar'].sort()
    );

    let xfoo = await getArtifact(result, 'public/xfoo');
    let bar = await getArtifact(result, 'public/bar');

    assert.equal(xfoo.trim(), 'xfoo');
    assert.equal(bar.trim(), 'bar');
  });

  test('upload 1mb artifact', async () => {
    let result = await testworker({
      payload: {
        image: 'taskcluster/test-ubuntu',
        command: cmd(
          'mkdir /artifacts/',
          'dd if=/dev/zero of=/artifacts/test.html  bs=1  count=1000000'
        ),
        features: {
          // No need to actually issue live logging...
          localLiveLog: false
        },
        artifacts: {
          'public/test.html': {
            type: 'file',
            expires: expires(),
            path: '/artifacts/test.html'
          }
        },
        maxRunTime: 5 * 60
      }
    });

    // Get task specific results
    assert.equal(result.run.state, 'completed', 'task should be successful');
    assert.equal(result.run.reasonResolved, 'completed', 'task should be successful');
    assert.ok('public/test.html' in result.artifacts,
              'Artifact does not appear in the list of uploaded artifacts');

    assert.ok(result.artifacts['public/test.html'].contentType === 'text/html');

    let testContents = await getArtifact(result, 'public/test.html');
    assert.ok(Buffer.byteLength(testContents) === 1000000,
              'Size of uploaded contents does not match original.');
  });

  test('upload binary artifact', async () => {
    let result = await testworker({
      payload: {
        image: 'taskcluster/test-ubuntu',
        command: cmd(
          'mkdir /artifacts/',
          'dd if=/dev/zero of=/artifacts/test  bs=1  count=200000',
          'tar -czvf artifacts.tar.gz /artifacts'
        ),
        features: {
          // No need to actually issue live logging...
          localLiveLog: false
        },
        artifacts: {
          'public/test': {
            type: 'file',
            expires: expires(),
            path: '/artifacts/test'
          }
        },
        maxRunTime: 5 * 60
      }
    });

    // Get task specific results
    assert.equal(result.run.state, 'completed', 'task should be successful');
    assert.equal(result.run.reasonResolved, 'completed', 'task should be successful');
    assert.ok('public/test' in result.artifacts,
              'Artifact does not appear in the list of uploaded artifacts');
    let contentType = 'application/octet-stream';
    assert.ok(result.artifacts['public/test'].contentType === contentType);
    // TODO handle response streams to validate content size
  });

  test('attempt to upload directory as file', async () => {
    let result = await testworker({
      payload: {
        image: 'taskcluster/test-ubuntu',
        command: cmd('ls'),
        artifacts: {
          'public/etc': {
            type: 'file',
            expires: expires(),
            path: '/etc/'
          }
        },
        maxRunTime: 5 * 60
      }
    });

    // Get task specific results
    assert.equal(result.run.state, 'completed', 'task should be unsuccessful');
    assert.equal(result.run.reasonResolved, 'completed', 'task should be unsuccessful');

    let errorMessage =
      'Error uploading "public/etc". Expected artifact to be a ' +
      '"file" but was "directory"';

    assert.ok(
      result.log.includes(errorMessage),
      'Error message does not appear in the logs'
    );

    assert.ok(result.artifacts['public/etc'], 'artifact is present when it shouldn\'t be');
    assert.equal(result.artifacts['public/etc'].storageType, 'error');
  });

  test('extract missing artifact', async () => {
    let result = await testworker({
      payload: {
        image: 'taskcluster/test-ubuntu',
        command: cmd(
          'echo "the user is:" > /username.txt',
          'whoami >> /username.txt',
          'echo "Okay, this is now done"'
        ),
        artifacts: {
          // Name -> Source
          'public/my-missing.txt': {
            type: 'file',
            path: '/this-file-is-missing.txt',
            expires: expires()
          }
        },
        maxRunTime: 5 * 60
      }
    });

    let errorMessage = '[taskcluster] Artifact "public/my-missing.txt" not found at "/this-file-is-missing.txt"';
    assert.ok(
      result.log.includes(errorMessage),
      'Missing file was not noted in the logs'
    );

    assert.equal(result.run.state, 'completed', 'task should be unsuccessful');
    assert.equal(result.run.reasonResolved, 'completed', 'task should be unsuccessful');
    assert.ok(result.artifacts['public/my-missing.txt']);
    assert.equal(result.artifacts['public/my-missing.txt'].storageType, 'error');
  });

  test('both missing and found artifacts', async () => {
    let result = await testworker({
      payload: {
        image: 'taskcluster/test-ubuntu',
        command: cmd(
          'echo "the user is:" > /username.txt',
          'whoami >> /username.txt',
          'echo "Okay, this is now done"'
        ),
        artifacts: {
          // name -> source
          'public/username.txt': {
            type: 'file',
            path: 'username.txt',
            expires: expires()
          },
          'public/passwd.txt': {
            type: 'file',
            path: '/etc/passwd',
            expires: expires()
          },
          'public/my-missing.txt': {
            type: 'file',
            path: '/this-file-is-missing.txt',
            expires: expires()
          }
        },
        maxRunTime: 5 * 60
      }
    });

    // Get task specific results.
    assert.equal(result.run.state, 'completed', 'task should be unsuccessful');
    assert.equal(result.run.reasonResolved, 'completed', 'task should be unsuccessful');

    // Ensure these have no errors...
    assert.equal(result.artifacts['public/username.txt'].storageType, 's3');
    assert.equal(result.artifacts['public/passwd.txt'].storageType, 's3');

    // Missing artifact should have an error...
    assert.equal(result.artifacts['public/my-missing.txt'].storageType, 'error');
  });

  test('upload retry', async () => {
    // Avoid iptables on local environment
    if (!process.env.WORKER_CI) {
      return;
    }

    let worker = new TestWorker(DockerWorker);
    await worker.launch();

    worker.once('Uploading public/xfoo', function() {
      iptables.reject({
        chain: 'OUTPUT',
        protocol: 'tcp',
        dport: 443,
        sudo: true
      });
    });

    let retry = false;

    worker.on('retrying artifact upload', function() {
      iptables.deleteRule({
        chain: 'OUTPUT',
        target: 'REJECT',
        protocol: 'tcp',
        dport: 443,
        sudo: true
      });

      retry = true;
    });

    let result = await worker.postToQueue({
      payload: {
        image: 'taskcluster/test-ubuntu',
        command: cmd(
          'mkdir /artifacts/',
          'echo "xfoo" > /artifacts/xfoo.txt',
          'ls /artifacts'
        ),
        features: {
          localLiveLog: false
        },
        artifacts: {
          'public/xfoo': {
            type: 'file',
            expires: expires(),
            path: '/artifacts/xfoo.txt'
          },
        },
        maxRunTime: 5 * 60
      }
    });

    // Get task specific results
    assert.equal(result.run.state, 'completed', 'task should be successful');
    assert.equal(result.run.reasonResolved, 'completed', 'task should be successful');

    assert.deepEqual(
      Object.keys(result.artifacts).sort(), ['public/xfoo'].sort()
    );

    let xfoo = await getArtifact(result, 'public/xfoo');

    assert.equal(xfoo.trim(), 'xfoo');
    assert.ok(retry);
  });
});
