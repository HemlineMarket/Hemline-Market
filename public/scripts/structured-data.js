// public/scripts/structured-data.js
// JSON-LD structured data for SEO - Google rich results

(function() {
  'use strict';
  
  window.HM_StructuredData = {
    
    // Generate Organization schema for the site
    organization: function() {
      return {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Hemline Market",
        "url": "https://hemlinemarket.com",
        "logo": "https://hemlinemarket.com/images/logo_square_compressed.png",
        "description": "Sustainable peer-to-peer fabric marketplace for sewists",
        "sameAs": [
          // Add social media URLs when available
        ]
      };
    },
    
    // Generate WebSite schema with search
    website: function() {
      return {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "Hemline Market",
        "url": "https://hemlinemarket.com",
        "potentialAction": {
          "@type": "SearchAction",
          "target": {
            "@type": "EntryPoint",
            "urlTemplate": "https://hemlinemarket.com/browse.html?q={search_term_string}"
          },
          "query-input": "required name=search_term_string"
        }
      };
    },
    
    // Generate Product schema for a listing
    product: function(listing) {
      if (!listing) return null;
      
      const priceDollars = listing.price_cents 
        ? (listing.price_cents / 100).toFixed(2) 
        : null;
      
      const schema = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": listing.title || "Fabric Listing",
        "description": listing.description || listing.title || "",
        "sku": listing.id,
        "category": "Fabric",
        "material": listing.fiber_content || listing.fabric_type || undefined,
      };
      
      // Add image if available
      if (listing.image_url_1) {
        schema.image = [listing.image_url_1];
        if (listing.image_url_2) schema.image.push(listing.image_url_2);
        if (listing.image_url_3) schema.image.push(listing.image_url_3);
      }
      
      // Add offer/pricing
      if (priceDollars) {
        const status = (listing.status || '').toLowerCase();
        const inStock = status !== 'sold' && listing.yards_available > 0;
        
        schema.offers = {
          "@type": "Offer",
          "url": `https://hemlinemarket.com/listing.html?id=${listing.id}`,
          "priceCurrency": "USD",
          "price": priceDollars,
          "priceValidUntil": new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          "availability": inStock 
            ? "https://schema.org/InStock" 
            : "https://schema.org/SoldOut",
          "itemCondition": "https://schema.org/NewCondition"
        };
        
        // Add seller info
        if (listing.seller_name || listing.store_name) {
          schema.offers.seller = {
            "@type": "Organization",
            "name": listing.store_name || listing.seller_name
          };
        }
      }
      
      // Add brand if designer is specified
      if (listing.designer) {
        schema.brand = {
          "@type": "Brand",
          "name": listing.designer
        };
      }
      
      // Add additional properties
      if (listing.yards_available) {
        schema.additionalProperty = [{
          "@type": "PropertyValue",
          "name": "Yards Available",
          "value": listing.yards_available
        }];
        
        if (listing.width_inches) {
          schema.additionalProperty.push({
            "@type": "PropertyValue",
            "name": "Width",
            "value": listing.width_inches + " inches"
          });
        }
      }
      
      return schema;
    },
    
    // Generate BreadcrumbList schema
    breadcrumbs: function(items) {
      // items = [{ name: "Home", url: "/" }, { name: "Browse", url: "/browse.html" }, ...]
      return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": items.map((item, index) => ({
          "@type": "ListItem",
          "position": index + 1,
          "name": item.name,
          "item": item.url.startsWith('http') ? item.url : `https://hemlinemarket.com${item.url}`
        }))
      };
    },
    
    // Generate ItemList schema for browse/search results
    itemList: function(listings, listName) {
      return {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": listName || "Fabric Listings",
        "numberOfItems": listings.length,
        "itemListElement": listings.slice(0, 10).map((listing, index) => ({
          "@type": "ListItem",
          "position": index + 1,
          "url": `https://hemlinemarket.com/listing.html?id=${listing.id}`,
          "name": listing.title
        }))
      };
    },
    
    // Inject schema into the page
    inject: function(schema) {
      if (!schema) return;
      
      // Remove existing schema with same type if present
      const schemaType = schema['@type'];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
        try {
          const existing = JSON.parse(el.textContent);
          if (existing['@type'] === schemaType) {
            el.remove();
          }
        } catch (e) {}
      });
      
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(schema);
      document.head.appendChild(script);
    },
    
    // Inject multiple schemas
    injectAll: function(schemas) {
      schemas.forEach(schema => this.inject(schema));
    }
  };
  
  // Auto-inject organization and website schemas on every page
  document.addEventListener('DOMContentLoaded', () => {
    window.HM_StructuredData.inject(window.HM_StructuredData.organization());
    window.HM_StructuredData.inject(window.HM_StructuredData.website());
  });
})();
