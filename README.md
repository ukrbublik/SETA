
### About
Simulteneous Editable TextArea on NodeJS

Allows to edit text files by many clients at real-time.

Prototype of cloud IDE like: 
- http://hyperdev.com 
- http://coderpad.io 
- Google Docs...

Made with `socket.io`, uses `diff3` algo to solve conflicts.

### Usage
```bash
npm install
node server.js
```
Edit config at `config.json` (change serverPort if you need, by default 80)

Open `http://localhost:80/` from several clients and try to edit text together

### Demo
https://seta.herokuapp.com/
