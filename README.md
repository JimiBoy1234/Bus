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

## Deploy to Vercel

1. Push this project to GitHub without the `.env` file
2. Import the repo into Vercel
3. Add `WMATA_API_KEY` in Vercel project environment variables
4. Deploy
5. Each time you change an environment variable in Vercel, redeploy the project

## Notes

- The browser talks only to the local Node server.
- The server calls WMATA's real-time bus prediction endpoint directly.
- The board refreshes every 30 seconds.
- For the live map, your WMATA key should also be subscribed to `Bus Route and Stop Methods`.
