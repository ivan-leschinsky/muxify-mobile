import { requestGoTo, takeGoToRequest } from './go-to-request';

it('gives Go to one time to the Host Screen of the Host that the Terminal named', () => {
  expect(takeGoToRequest('mac')).toBe(false);

  requestGoTo('mac');

  expect(takeGoToRequest('linux')).toBe(false);
  expect(takeGoToRequest('mac')).toBe(true);
  expect(takeGoToRequest('mac')).toBe(false);
});
