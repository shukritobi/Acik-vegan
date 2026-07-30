# Acik Vegan Ecommerce Concept

A responsive Malay-language ecommerce concept for Acik Vegan, built as a static GitHub Pages site.

## Included

- Five-product catalogue: edamame, white soy, black soy, chickpea, and five-bean tempe
- Responsive mobile and desktop design
- Shopping cart with quantity controls and browser persistence
- Customer checkout form and order summary
- FPX, card, and DuitNow QR payment choices in the interface
- Brand story, production process, social links, stockist section, and FAQ
- GitHub Pages deployment workflow
- Billplz-ready Cloudflare Worker backend with server-side price validation, bill creation, callback verification, KV order storage, and payment-status lookup
- Customer payment result page

## Important launch notes

The catalogue prices are placeholders because no verified public Acik Vegan price list was found. Confirm all prices, weights, stock, ingredients, allergen wording, delivery coverage, certifications, product photography rights, and business details with Acik Vegan before launch.

The storefront and payment architecture are built, but real collection remains intentionally disabled until Acik Vegan supplies its verified merchant credentials. Do not place a Billplz secret key inside `index.html` or any public GitHub repository.

## Deploy on GitHub Pages

1. Open the repository's **Settings > Pages**.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Push to `main` or manually run the `Deploy Acik Vegan to GitHub Pages` workflow.
4. The expected project URL is `https://shukritobi.github.io/Acik-vegan/`.

## Connect Billplz

1. Create and verify a Billplz merchant account.
2. Create a Collection and copy its Collection ID.
3. Deploy `payment-worker.js` as a Cloudflare Worker with a KV namespace binding named `ORDERS`.
4. Add these Worker secrets/variables:
   - `BILLPLZ_SECRET_KEY`
   - `BILLPLZ_COLLECTION_ID`
   - `BILLPLZ_API_BASE` (`https://www.billplz-sandbox.com` for testing, then `https://www.billplz.com`)
   - `SITE_URL` (`https://shukritobi.github.io/Acik-vegan`)
   - `ALLOWED_ORIGIN` (`https://shukritobi.github.io`)
5. In this GitHub repository, add an Actions variable named `PAYMENT_API_BASE` containing the deployed Worker URL.
6. Run the Pages deployment again. The build injects the endpoint into the checkout and payment-result pages automatically.
7. Test the full flow in Billplz Sandbox before switching to production credentials.

## Research basis

The concept uses publicly reported information about Acik Vegan's founder, five tempe variants, small-batch research and development, local-farmer sourcing, collaboration with an Orang Asli community for leaf packaging, home delivery, and availability at selected Jaya Grocer branches. Images are remotely referenced from the public article for demonstration only and should be replaced with owner-approved originals for production.
