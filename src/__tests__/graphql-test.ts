import { describe, it } from 'mocha';

import { expectJSON } from '../__testUtils__/expectJSON';

import { buildSchema } from '../utilities/buildASTSchema';

import { graphql, graphqlSync } from '../graphql';

const schema = buildSchema(`
  enum Color {
    RED
    GREEN
  }

  input Filter {
    color: Color
  }

  type Query {
    user(color: Color, filter: Filter): String
  }
`);

describe('graphql: hideSuggestions', () => {
  it('hides suggestions in validation errors', async () => {
    const result = await graphql({
      schema,
      source: '{ usr }',
      hideSuggestions: true,
    });

    expectJSON(result).toDeepEqual({
      errors: [
        {
          message: 'Cannot query field "usr" on type "Query".',
          locations: [{ line: 1, column: 3 }],
        },
      ],
    });
  });

  it('hides suggestions in validation errors (sync)', () => {
    const result = graphqlSync({
      schema,
      source: '{ usr }',
      hideSuggestions: true,
    });

    expectJSON(result).toDeepEqual({
      errors: [
        {
          message: 'Cannot query field "usr" on type "Query".',
          locations: [{ line: 1, column: 3 }],
        },
      ],
    });
  });

  it('hides suggestions in variable coercion errors', () => {
    const result = graphqlSync({
      schema,
      source: 'query ($c: Color) { user(color: $c) }',
      variableValues: { c: 'RDE' },
      hideSuggestions: true,
    });

    expectJSON(result).toDeepEqual({
      errors: [
        {
          message:
            'Variable "$c" got invalid value "RDE"; Value "RDE" does not exist in "Color" enum.',
          locations: [{ line: 1, column: 8 }],
        },
      ],
    });
  });

  it('hides suggestions in input object coercion errors', () => {
    const result = graphqlSync({
      schema,
      source: 'query ($f: Filter) { user(filter: $f) }',
      variableValues: { f: { colour: 'RED' } },
      hideSuggestions: true,
    });

    expectJSON(result).toDeepEqual({
      errors: [
        {
          message:
            'Variable "$f" got invalid value { colour: "RED" }; Field "colour" is not defined by type "Filter".',
          locations: [{ line: 1, column: 8 }],
        },
      ],
    });
  });

  it('keeps suggestions in validation and execution errors by default', async () => {
    const validationResult = await graphql({ schema, source: '{ usr }' });
    expectJSON(validationResult).toDeepEqual({
      errors: [
        {
          message:
            'Cannot query field "usr" on type "Query". Did you mean "user"?',
          locations: [{ line: 1, column: 3 }],
        },
      ],
    });

    const executionResult = await graphql({
      schema,
      source: 'query ($c: Color) { user(color: $c) }',
      variableValues: { c: 'RDE' },
    });
    expectJSON(executionResult).toDeepEqual({
      errors: [
        {
          message:
            'Variable "$c" got invalid value "RDE"; Value "RDE" does not exist in "Color" enum. Did you mean the enum value "RED"?',
          locations: [{ line: 1, column: 8 }],
        },
      ],
    });
  });
});
