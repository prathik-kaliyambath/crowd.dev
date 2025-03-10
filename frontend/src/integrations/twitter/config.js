import TwitterConnect from './components/twitter-connect.vue';

export default {
  enabled: true,
  name: 'Twitter',
  backgroundColor: '#d2ebfc',
  borderColor: '#d2ebfc',
  description:
    'Connect Twitter to sync profile information, followers, and relevant tweets.',
  image:
    'https://cdn-icons-png.flaticon.com/512/733/733579.png',
  connectComponent: TwitterConnect,
};
