import {
  changes,
  fieldsFromParam,
  fieldsParam,
  saveTopicEdit,
  typedFields,
  type TopicChange,
  type TopicFields,
  type TopicWrite,
} from './topic-edit';

const ON_HOST: TopicFields = {
  title: 'Fix login',
  note: 'at step 3',
  tags: ['work', 'old'],
};

/** A Host that records each change it is sent, and refuses the fields in `refuse`. */
function host(refuse: TopicChange['field'][] = []) {
  const sent: TopicChange[] = [];
  const write = async (change: TopicChange): Promise<TopicWrite> => {
    sent.push(change);
    return refuse.includes(change.field) ? { kind: 'failed', error: `no ${change.field}` } : { kind: 'changed' };
  };
  return { write, sent };
}

function save(on: ReturnType<typeof host>, saved: TopicFields, wanted: TopicFields) {
  return saveTopicEdit(saved, wanted, on.write);
}

describe('Save on the Edit sheet', () => {
  it('sends only the fields that changed', async () => {
    const on = host();

    const { saved, errors } = await save(on, ON_HOST, {
      ...ON_HOST,
      note: 'at step 4',
    });

    expect(on.sent).toEqual([{ field: 'note', note: 'at step 4' }]);
    expect(saved).toEqual({ ...ON_HOST, note: 'at step 4' });
    expect(errors).toEqual({});
  });

  it('sends nothing when nothing changed, and Tags in another order are no change', async () => {
    const on = host();

    await save(on, ON_HOST, { ...ON_HOST, tags: ['old', 'work'] });

    expect(on.sent).toEqual([]);
  });

  it('sends each changed field, once, in field order', async () => {
    const on = host();

    await save(on, ON_HOST, {
      title: 'Fix logout',
      note: null,
      tags: ['work'],
    });

    expect(on.sent).toEqual([
      { field: 'title', title: 'Fix logout' },
      { field: 'note', note: null },
      { field: 'tags', tags: ['work'] },
    ]);
  });

  it('puts a refusal under its field, and a second Save sends only what still differs', async () => {
    const wanted: TopicFields = {
      title: 'Fix logout',
      note: 'at step 4',
      tags: ['work'],
    };
    const first = host(['note']);

    const partial = await save(first, ON_HOST, wanted);

    expect(first.sent).toEqual([
      { field: 'title', title: 'Fix logout' },
      { field: 'note', note: 'at step 4' },
      { field: 'tags', tags: ['work'] },
    ]);
    expect(partial.errors).toEqual({ note: 'no note' });
    expect(partial.saved).toEqual({ ...wanted, note: ON_HOST.note });

    const second = host();
    const retry = await save(second, partial.saved, wanted);

    expect(second.sent).toEqual([{ field: 'note', note: 'at step 4' }]);
    expect(retry).toEqual({ saved: wanted, errors: {} });
  });
});

describe('what the user typed', () => {
  it('trims the title and the Note, and an empty Note is no Note', () => {
    expect(typedFields('  Fix login ', '   ', ['work'])).toEqual({
      title: 'Fix login',
      note: null,
      tags: ['work'],
    });
    expect(typedFields('Fix login', ' at step 3 ', [])).toMatchObject({
      note: 'at step 3',
    });
  });

  it('is no change when it matches the Host', () => {
    expect(changes(ON_HOST, typedFields(' Fix login', 'at step 3 ', ['work', 'old']))).toEqual([]);
  });
});

describe('the Topic route param of the Edit sheet', () => {
  it('gives back the fields', () => {
    expect(fieldsFromParam(fieldsParam(ON_HOST))).toEqual(ON_HOST);
    expect(fieldsFromParam(fieldsParam({ ...ON_HOST, note: null }))).toEqual({
      ...ON_HOST,
      note: null,
    });
  });

  it.each([
    undefined,
    'not json',
    'null',
    '{"title":1,"note":null,"tags":[]}',
    '{"title":"a","note":3,"tags":[]}',
    '{"title":"a","note":null,"tags":[1]}',
  ])('gives null for %p', (param) => {
    expect(fieldsFromParam(param)).toBeNull();
  });
});

it('stops at a write that the Host has in doubt, and says so', async () => {
  const sent: string[] = [];
  const write = async (change: { field: string }) => {
    sent.push(change.field);
    return { kind: 'unknown', message: 'The Request changed the records and did not finish.' } as const;
  };
  const wanted = { ...ON_HOST, title: 'Fix logout', note: 'new' };

  expect(await saveTopicEdit(ON_HOST, wanted, write)).toEqual({
    saved: ON_HOST, errors: {}, inDoubt: 'The Request changed the records and did not finish.',
  });
  expect(sent).toEqual(['title']);
});
