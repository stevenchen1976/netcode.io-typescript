var { ByteBuffer, Long } = require('../bin/ByteBuffer');
var { Utils } = require('../bin/Utils');
var {
  PacketHelper,
  DisconnectPacket,
  PacketType,
  RequestPacket,
  DeniedPacket,
  ChallengePacket,
  ResponsePacket,
  KeepAlivePacket,
  PayloadPacket,
} = require('../bin/Packet');
var Defines = require('../bin/Defines');
var chacha = require('../bin/chacha20poly1305');
var assert = require('assert');
const { Errors } = require('../bin/Errors');
const { ConnectToken } = require('../bin/Token');

var TEST_PROTOCOL_ID = Long.fromNumber(0x1122334455667788);
var TEST_CONNECT_TOKEN_EXPIRY = 30;
var TEST_SEQUENCE_START = Long.fromNumber(1000);
var TEST_TIMEOUT_SECONDS = 15;
var TEST_PRIVATE_KEY = new Uint8Array([
  0x60,
  0x6a,
  0xbe,
  0x6e,
  0xc9,
  0x19,
  0x10,
  0xea,
  0x9a,
  0x65,
  0x62,
  0xf6,
  0x6f,
  0x2b,
  0x30,
  0xe4,
  0x43,
  0x71,
  0xd6,
  0x2c,
  0xd1,
  0x99,
  0x27,
  0x26,
  0x6b,
  0x3c,
  0x60,
  0xf4,
  0xb7,
  0x15,
  0xab,
  0xa1,
]);
var TEST_CLIENT_ID = Long.fromNumber(0x1);

function assertBytesEqual(a1, a2, str) {
  assert.equal(Utils.arrayEqual(a1, a2), true, str);
}

describe('Test Packet', function () {
  it('test sequence', function () {
    assert.equal(
      PacketHelper.sequenceNumberBytesRequired(new Long(0, 0)),
      1,
      'oh no'
    );
    assert.equal(
      PacketHelper.sequenceNumberBytesRequired(Long.fromNumber(0x11)),
      1,
      'oh no'
    );
    assert.equal(
      PacketHelper.sequenceNumberBytesRequired(Long.fromNumber(0x1122)),
      2,
      'oh no'
    );
    assert.equal(
      PacketHelper.sequenceNumberBytesRequired(Long.fromNumber(0x112233)),
      3,
      'oh no'
    );
    assert.equal(
      PacketHelper.sequenceNumberBytesRequired(Long.fromNumber(0x11223344)),
      4,
      'oh no'
    );
    assert.equal(
      PacketHelper.sequenceNumberBytesRequired(new Long(0x11223344, 0x55)),
      5,
      'oh no'
    );
    assert.equal(
      PacketHelper.sequenceNumberBytesRequired(Long.fromNumber(0x112233445566)),
      6,
      'oh no'
    );
    assert.equal(
      PacketHelper.sequenceNumberBytesRequired(
        Long.fromNumber(0x11223344556677)
      ),
      7,
      'oh no'
    );
    assert.equal(
      PacketHelper.sequenceNumberBytesRequired(
        Long.fromNumber(0x1122334455667788)
      ),
      8,
      'oh no'
    );
  });

  it('test sequence write/read', function () {
    var p = new DisconnectPacket();
    var buf = ByteBuffer.allocate(4);
    var prefixByte = PacketHelper.writePacketPrefix(
      p,
      buf,
      TEST_SEQUENCE_START
    );
    assert.equal(prefixByte, 38);
    buf.clearPosition();
    assert.equal(buf.readUint8(), 38);
    assert.equal(buf.readUint16(), TEST_SEQUENCE_START.low);
    buf.clearPosition();
    buf.skipPosition(1);
    var seq = PacketHelper.readSequence(buf, 100, prefixByte);
    assert.equal(seq.equals(TEST_SEQUENCE_START), true);

    var buf2 = ByteBuffer.allocate(9);
    var maxSeq = new Long(0xffffffff, 0xffffffff);
    var prefixByte2 = PacketHelper.writePacketPrefix(p, buf2, maxSeq);
    assert.equal(prefixByte2, (8 << 4) + 6);
    buf2.clearPosition();
    buf2.skipPosition(1);
    assert.equal(buf2.readUint64().equals(maxSeq), true);
    buf2.clearPosition();
    buf2.skipPosition(1);
    var seq2 = PacketHelper.readSequence(buf2, 100, prefixByte2);
    assert.equal(seq2.equals(maxSeq), true);
  });

  it('test connection request packet', function () {
    var tokenKey = Utils.generateKey();
    var builds = testBuildRequestPacket(tokenKey);
    var inputPacket = builds[0];
    var decryptedToken = builds[1];

    var buffer = new Uint8Array(2048);
    var packetKey = Utils.generateKey();
    var bytesWritten = inputPacket.write(
      buffer,
      TEST_PROTOCOL_ID,
      TEST_SEQUENCE_START,
      packetKey
    );
    assert.equal(bytesWritten > 0, true);
    var allowedPackets = new Uint8Array(PacketType.ConnectionNumPackets);
    for (let i = 0; i < allowedPackets.length; i++) {
      allowedPackets[i] = 1;
    }

    var outPacket = new RequestPacket();
    const err = outPacket.read(buffer, bytesWritten, {
      protocolId: TEST_PROTOCOL_ID,
      currentTimestamp: Date.now(),
      readPacketKey: packetKey,
      privateKey: tokenKey,
      allowedPackets,
      replayProtection: null,
    });
    assert.equal(err, Errors.none, Errors[err]);
    assertBytesEqual(outPacket._versionInfo, inputPacket._versionInfo, 'oh no');
    assertBytesEqual(
      outPacket._versionInfo,
      Defines.VERSION_INFO_BYTES_ARRAY,
      'oh no'
    );
    assert.equal(outPacket._protocolID.equals(inputPacket._protocolID), true);
    assert.equal(
      outPacket._connectTokenExpireTimestamp.equals(
        inputPacket._connectTokenExpireTimestamp
      ),
      true
    );
    assert.equal(
      outPacket._connectTokenSequence.equals(inputPacket._connectTokenSequence),
      true
    );
    assertBytesEqual(decryptedToken, outPacket._token.tokenData.bytes, 'oh no');
  });

  it('test connection denied packet', function () {
    var inputPacket = new DeniedPacket();
    var buffer = new Uint8Array(Defines.MAX_PACKET_BYTES);
    var packetKey = Utils.generateKey();
    var bytesWritten = inputPacket.write(
      buffer,
      TEST_PROTOCOL_ID,
      TEST_SEQUENCE_START,
      packetKey
    );
    assert.equal(bytesWritten > 0, true);
    var allowedPackets = new Uint8Array(PacketType.ConnectionNumPackets);
    for (let i = 0; i < allowedPackets.length; i++) {
      allowedPackets[i] = 1;
    }

    var outP = new DeniedPacket();
    var err = outP.read(buffer, bytesWritten, {
      protocolId: TEST_PROTOCOL_ID,
      currentTimestamp: Date.now(),
      readPacketKey: packetKey,
      privateKey: null,
      allowedPackets,
      replayProtection: null,
    });
    assert.equal(err === Errors.none, true, 'oh no');
    assert.equal(outP.sequence().equals(TEST_SEQUENCE_START), true);
  });

  it('test challenge packet', function () {
    var inputPacket = new ChallengePacket();
    inputPacket.setProperties(
      0,
      Utils.getRandomBytes(Defines.CHALLENGE_TOKEN_BYTES)
    );
    var buffer = new Uint8Array(Defines.MAX_PACKET_BYTES);
    var packetKey = Utils.generateKey();
    var bytesWritten = inputPacket.write(
      buffer,
      TEST_PROTOCOL_ID,
      TEST_SEQUENCE_START,
      packetKey
    );
    assert.equal(bytesWritten > 0, true);
    var allowedPackets = new Uint8Array(PacketType.ConnectionNumPackets);
    for (let i = 0; i < allowedPackets.length; i++) {
      allowedPackets[i] = 1;
    }

    var outP = new ChallengePacket();
    var err = outP.read(buffer, bytesWritten, {
      protocolId: TEST_PROTOCOL_ID,
      currentTimestamp: Date.now(),
      readPacketKey: packetKey,
      privateKey: null,
      allowedPackets,
      replayProtection: null,
    });
    assert.equal(err === Errors.none, true, 'oh no');
    assert.equal(outP.sequence().equals(TEST_SEQUENCE_START), true);
    assert.equal(
      outP.challengeTokenSequence,
      inputPacket.challengeTokenSequence
    );
    assertBytesEqual(outP.tokenData, inputPacket.tokenData, 'oh no');
  });

  it('test connection response packet', function () {
    var inputPacket = new ResponsePacket();
    inputPacket.setProperties(
      0,
      Utils.getRandomBytes(Defines.CHALLENGE_TOKEN_BYTES)
    );
    var buffer = new Uint8Array(Defines.MAX_PACKET_BYTES);
    var packetKey = Utils.generateKey();
    var bytesWritten = inputPacket.write(
      buffer,
      TEST_PROTOCOL_ID,
      TEST_SEQUENCE_START,
      packetKey
    );
    assert.equal(bytesWritten > 0, true);
    var allowedPackets = new Uint8Array(PacketType.ConnectionNumPackets);
    for (let i = 0; i < allowedPackets.length; i++) {
      allowedPackets[i] = 1;
    }

    var outP = new ResponsePacket();
    var err = outP.read(buffer, bytesWritten, {
      protocolId: TEST_PROTOCOL_ID,
      currentTimestamp: Date.now(),
      readPacketKey: packetKey,
      privateKey: null,
      allowedPackets,
      replayProtection: null,
    });
    assert.equal(err === Errors.none, true, 'oh no');
    assert.equal(outP.sequence().equals(TEST_SEQUENCE_START), true);
    assert.equal(
      outP.challengeTokenSequence,
      inputPacket.challengeTokenSequence
    );
    assertBytesEqual(outP.tokenData, inputPacket.tokenData, 'oh no');
  });

  it('test keep alive packet', function () {
    var inputPacket = new KeepAlivePacket();
    inputPacket.setProperties(10, 128);
    var buffer = new Uint8Array(Defines.MAX_PACKET_BYTES);
    var packetKey = Utils.generateKey();
    var bytesWritten = inputPacket.write(
      buffer,
      TEST_PROTOCOL_ID,
      TEST_SEQUENCE_START,
      packetKey
    );
    assert.equal(bytesWritten > 0, true);
    var allowedPackets = new Uint8Array(PacketType.ConnectionNumPackets);
    for (let i = 0; i < allowedPackets.length; i++) {
      allowedPackets[i] = 1;
    }

    var outP = new KeepAlivePacket();
    var err = outP.read(buffer, bytesWritten, {
      protocolId: TEST_PROTOCOL_ID,
      currentTimestamp: Date.now(),
      readPacketKey: packetKey,
      privateKey: null,
      allowedPackets,
      replayProtection: null,
    });
    assert.equal(err === Errors.none, true, 'oh no');
    assert.equal(outP.sequence().equals(TEST_SEQUENCE_START), true);
    assert.equal(outP.clientIndex, inputPacket.clientIndex);
    assert.equal(outP.maxClients, inputPacket.maxClients);
  });

  it('test payload packet', function () {
    var payload = Utils.getRandomBytes(Defines.MAX_PAYLOAD_BYTES);
    var inputPacket = new PayloadPacket(payload);
    var buffer = new Uint8Array(Defines.MAX_PACKET_BYTES);
    var packetKey = Utils.generateKey();
    var bytesWritten = inputPacket.write(
      buffer,
      TEST_PROTOCOL_ID,
      TEST_SEQUENCE_START,
      packetKey
    );
    assert.equal(bytesWritten > 0, true);
    var allowedPackets = new Uint8Array(PacketType.ConnectionNumPackets);
    for (let i = 0; i < allowedPackets.length; i++) {
      allowedPackets[i] = 1;
    }

    var outP = new PayloadPacket();
    var err = outP.read(buffer, bytesWritten, {
      protocolId: TEST_PROTOCOL_ID,
      currentTimestamp: Date.now(),
      readPacketKey: packetKey,
      privateKey: null,
      allowedPackets,
      replayProtection: null,
    });
    assert.equal(err === Errors.none, true, Errors[err]);
    assert.equal(outP.sequence().equals(TEST_SEQUENCE_START), true);
    assertBytesEqual(outP.payloadData, inputPacket.payloadData, 'oh no');
  });

  it('test disconnect packet', function () {
    var p = new DisconnectPacket();
    var buf = new Uint8Array(Defines.MAX_PACKET_BYTES);
    var key = Utils.generateKey();
    var writeLen = p.write(buf, TEST_PROTOCOL_ID, TEST_SEQUENCE_START, key);
    assert.equal(writeLen, 3 + Defines.MAC_BYTES, 'oh no');
    var allowedPackets = new Uint8Array(PacketType.ConnectionNumPackets);
    for (let i = 0; i < allowedPackets.length; i++) {
      allowedPackets[i] = 1;
    }
    var outP = new DisconnectPacket();
    var err = outP.read(buf, writeLen, {
      protocolId: TEST_PROTOCOL_ID,
      currentTimestamp: Date.now(),
      readPacketKey: key,
      privateKey: null,
      allowedPackets,
      replayProtection: null,
    });
    assert.equal(err === Errors.none, true, 'oh no');
    assert.equal(outP.sequence().equals(TEST_SEQUENCE_START), true);
  });
});

function ipStringToBytes(ip) {
  var octets = ip.split('.');
  if (octets.length !== 4) {
    console.error('only support ipv4');
    return;
  }
  const bytes = new Uint8Array(4);
  for (var i = 0; i < octets.length; ++i) {
    var octet = parseInt(octets[i], 10);
    if (Number.isNaN(octet) || octet < 0 || octet > 255) {
      throw new Error('Each octet must be between 0 and 255');
    }
    bytes[i] = octet;
  }
  return bytes;
}

function testBuildRequestPacket(key) {
  var addr = {
    ip: ipStringToBytes('10.20.30.40'),
    port: 40000,
  };
  var userData = Utils.getRandomBytes(Defines.USER_DATA_BYTES);
  var connectToken = new ConnectToken();
  assert.equal(
    connectToken.generate(
      TEST_CLIENT_ID,
      [addr],
      TEST_PROTOCOL_ID,
      TEST_CONNECT_TOKEN_EXPIRY,
      TEST_TIMEOUT_SECONDS,
      TEST_SEQUENCE_START,
      userData,
      key
    ),
    true
  );
  var tokenBuffer = connectToken.write();
  assert.equal(tokenBuffer !== undefined, true, 'oh no');

  var outToken = new ConnectToken();
  var readRet = outToken.read(tokenBuffer);
  assert.equal(readRet, Errors.none, 'oh no');

  var tokenData = connectToken.privateData.decrypt(
    TEST_PROTOCOL_ID,
    connectToken.expireTimestamp,
    connectToken.sequence,
    key
  );
  assert(tokenData !== undefined, true);
  var decryptedToken = new Uint8Array(tokenData.length);
  decryptedToken.set(tokenData);

  connectToken.privateData.tokenData.clearPosition();
  var mac = new Uint8Array(Defines.MAC_BYTES);
  const arr = new Uint8Array([
    ...connectToken.privateData.tokenData.bytes,
    ...mac,
  ]);
  connectToken.privateData.tokenData = new ByteBuffer(arr);
  assert.equal(
    connectToken.privateData.encrypt(
      TEST_PROTOCOL_ID,
      connectToken.expireTimestamp,
      TEST_SEQUENCE_START,
      key
    ),
    true
  );

  var p = new RequestPacket();
  p.setProperties(
    Defines.VERSION_INFO_BYTES_ARRAY,
    TEST_PROTOCOL_ID,
    connectToken.expireTimestamp,
    TEST_SEQUENCE_START,
    connectToken.privateData.buffer
  );
  p._token = connectToken.privateData;
  return [p, decryptedToken];
}
