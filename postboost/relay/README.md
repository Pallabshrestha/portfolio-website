# NVIDIA CORS relay

NVIDIA's inference endpoint sends no CORS headers, so PostBoost cannot call it
from the browser. This Worker adds them. It holds no API key - yours is
forwarded from the page on each request.

    npm install -g wrangler
    wrangler login
    wrangler deploy

Copy the printed `https://postboost-nvidia-relay.<subdomain>.workers.dev` URL
into PostBoost's **Relay URL** field, pick NVIDIA as the provider, and captions
will work. Anthropic needs none of this.

Free tier is 100,000 Worker requests a day, which this will not come near.
