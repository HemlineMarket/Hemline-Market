// api/new-listings.js
import supabaseAdmin from './_supabaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Grab the most recent active listings
    const { data, error } = await supabaseAdmin
      .from('listings')
      .select(
        'id, title, price_cents, price_display, seller_handle, seller_initials, slug, created_at, status'
      )
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(12);

    if (error) throw error;

    const items = (data || []).map((row) => {
      const priceDisplay =
        row.price_display ||
        (typeof row.price_cents === 'number'
          ? `$${(row.price_cents / 100).toFixed(2)}`
          : '');

      const sellerHandle = row.seller_handle || '';

      const initials =
        row.seller_initials ||
        (sellerHandle
          ? sellerHandle.replace(/^@/, '').slice(0, 2).toUpperCase()
          : 'HM');

      const url = row.slug
        ? `/listing/${row.slug}`
        : `/listing/${row.id}`;

      return {
        id: row.id,
        title: row.title || 'Untitled listing',
        price_display: priceDisplay,
        seller_handle: sellerHandle,
        seller_initials: initials,
        url,
      };
    });

    res.status(200).json(items);
  } catch (err) {
    console.error('new-listings error', err);
    res.status(500).json({ error: 'Failed to load listings' });
  }
}
