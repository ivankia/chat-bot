const MTProto = require('@mtproto/core');
const { getSRPParams } = require('@mtproto/core');
const prompts = require('prompts');
const path = require('path');
const request = require('request');
require('dotenv').config();

const api_id = process.env.API_ID;
const api_hash = process.env.API_HASH;
const phone = process.env.PHONE;
const channelId = process.env.CHANNEL_ID;

async function getPhone() {
  return phone;
  // return (await prompts({
  //   type: 'text',
  //   name: 'phone',
  //   message: 'Enter your phone number:'
  // })).phone
}

async function getCode() {
  // you can implement your code fetching strategy here
  return (await prompts({
    type: 'text',
    name: 'code',
    message: 'Enter the code sent:',
  })).code
}

async function getPassword() {
  return (await prompts({
    type: 'text',
    name: 'password',
    message: 'Enter Password:',
  })).password
}

const mtproto = new MTProto({
  api_id,
  api_hash,
  storageOptions: {
    path: path.resolve(__dirname, './storage.json'),
  },
});

function startListener() {
  console.log(new Date() + ' [+] starting listener')
  mtproto.updates.on('updates', async ({updates}) => {
    const newChannelMessages = updates.filter((update) => update._ === 'updateNewChannelMessage').map(({message}) => message) // filter `updateNewChannelMessage` types only and extract the 'message' object

    for (const message of newChannelMessages) {
      // printing new channel messages
      if (channelId === message.peer_id.channel_id) {
        const matches = message.message.match(/[A-Za-z0-9]+\s(ниже|выше)\s(\d+\.?\d+)\s(шорт|лонг)/g);

        // console.log(matches);
        // continue;

        if (matches?.length) {
          request.post(process.env.API_CLOSE, {}, function (error, response, body) {
            if (!error && response.statusCode == 200) {
              console.log(body);
            }
          });
        }

        matches.forEach(signal => {
          const sig = signal.split(' ');

          request.post(
              process.env.API_SIGNAL, { json: {
                  symbol: sig[0],
                  side: sig[3] === 'шорт' ? 'SHORT' : 'LONG',
                  price: sig[2],
                }
              },
              function (error, response, body) {
                if (!error && response.statusCode == 200) {
                  console.log(body);
                }
              }
          );
        });
      }
    }
  });
}


// checking authentication status
mtproto
    .call('users.getFullUser', {
      id: {
        _: 'inputUserSelf',
      },
    })
    .then(startListener) // means the user is logged in -> so start the listener
    .catch(async error => {

      // The user is not logged in
      console.log('[+] You must log in')
      const phone_number = await getPhone()

      mtproto.call('auth.sendCode', {
        phone_number: phone_number,
        settings: {
          _: 'codeSettings',
        },
      })
          .catch(error => {
            if (error.error_message.includes('_MIGRATE_')) {
              const [type, nextDcId] = error.error_message.split('_MIGRATE_');

              mtproto.setDefaultDc(+nextDcId);

              return sendCode(phone_number);
            }
          })
          .then(async result => {
            return mtproto.call('auth.signIn', {
              phone_code: await getCode(),
              phone_number: phone_number,
              phone_code_hash: result.phone_code_hash,
            });
          })
          .catch(error => {
            if (error.error_message === 'SESSION_PASSWORD_NEEDED') {
              return mtproto.call('account.getPassword').then(async result => {
                const { srp_id, current_algo, srp_B } = result;
                const { salt1, salt2, g, p } = current_algo;

                const { A, M1 } = await getSRPParams({
                  g,
                  p,
                  salt1,
                  salt2,
                  gB: srp_B,
                  password: await getPassword(),
                });

                return mtproto.call('auth.checkPassword', {
                  password: {
                    _: 'inputCheckPasswordSRP',
                    srp_id,
                    A,
                    M1,
                  },
                });
              });
            }
          })
          .then(result => {
            console.log('[+] successfully authenticated');
            // start listener since the user has logged in now
            startListener()
          });
    })