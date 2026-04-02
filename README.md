# WMATA Bus Dashboard

Simple local dashboard for these WMATA stops:

- `4000296` Mount Vernon Bookstore
- `4001060` Rt1 to Potomac Yard
- `4001061` Rt1 to Braddock

## Run it

1. Copy `.env.example` to `.env`
2. Put your WMATA API key in `.env`
3. Run:

```bash
npm start
```

4. Open `http://localhost:3000`

## Notes

- The browser talks only to the local Node server.
- The server calls WMATA's real-time bus prediction endpoint directly.
- The board refreshes every 30 seconds.
