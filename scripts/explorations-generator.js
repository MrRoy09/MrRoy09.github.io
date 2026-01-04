/* global hexo */

'use strict';

const pagination = require('hexo-pagination');

hexo.extend.generator.register('explorations', function(locals) {
  const config = this.config;

  // Check if all_posts exists
  if (!locals.all_posts) {
    return [];
  }

  // Get all posts (including hidden ones) and filter by Explorations category
  const explorationsPosts = locals.all_posts.filter(post => {
    if (!post.categories || !post.categories.length) return false;
    return post.categories.some(cat => cat.name === 'Explorations');
  });

  if (explorationsPosts.length === 0) {
    return [];
  }

  // Sort by date (default order)
  const orderBy = config.index_generator.order_by || '-date';
  const sortedPosts = explorationsPosts.sort(orderBy);

  // Sort by sticky if applicable
  sortedPosts.data.sort((a, b) => (b.sticky || 0) - (a.sticky || 0));

  const paginationDir = config.pagination_dir || 'page';

  return pagination('explorations/', sortedPosts, {
    perPage: config.index_generator.per_page || 10,
    layout: ['explorations', 'index'],
    format: paginationDir + '/%d/',
    data: {
      __explorations: true,
      subtitle: 'Curiosity-driven dives'
    }
  });
});
