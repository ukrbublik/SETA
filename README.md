
### Info
Simulteneous Editable TextArea on NodeJS

Allows to edit text files by many clients at same time.

Prototype of cloud IDE like: 
hyperdev.com 
coderpad.io 
nitrous.io
or Google Docs...

Made with `socket.io`, uses `diff3` algo to solve conflicts.

### Usage
```bash
npm install
node server.js
```
Edit config at `config.json` (change serverPort if you need, by default 1337)

Open `http://localhost:1337/` from several clients and try to edit text together
