import { expect } from 'chai';
import { describe, it } from 'mocha';

import { expectJSON } from '../__testUtils__/expectJSON';

import { parse } from '../language/parser';

import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLObjectType,
} from '../type/definition';
import { GraphQLString } from '../type/scalars';
import { GraphQLSchema } from '../type/schema';

import { execute } from '../execution/execute';
import { subscribe } from '../execution/subscribe';

import { graphql, graphqlSync } from '../graphql';

const ColorType = new GraphQLEnumType({
  name: 'Color',
  values: {
    RED: { value: 'RED' },
  },
});

const FilterInput = new GraphQLInputObjectType({
  name: 'FilterInput',
  fields: {
    color: { type: ColorType },
  },
});

const QueryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    color: {
      type: GraphQLString,
      args: { filter: { type: FilterInput } },
      resolve: () => 'red',
    },
    user: { type: GraphQLString },
  },
});

const SubscriptionType = new GraphQLObjectType({
  name: 'Subscription',
  fields: {
    color: {
      type: GraphQLString,
      args: { filter: { type: FilterInput } },
      subscribe: () => [],
    },
  },
});

const schema = new GraphQLSchema({
  query: QueryType,
  subscription: SubscriptionType,
});

describe('graphql: Hide suggestions', () => {
  it('keeps suggestions in validation errors by default', async () => {
    const result = await graphql({
      schema,
      source: `
        {
          usr
        }
      `,
    });

    expectJSON(result).toDeepEqual({
      errors: [
        {
          message: 'Cannot query field "usr" on type "Query". Did you mean "user"?',
          locations: [{ line: 3, column: 11 }],
        },
      ],
    });
  });

  it('hides suggestions in validation errors', async () => {
    const result = await graphql({
      schema,
      source: `
        {
          usr
        }
      `,
      hideSuggestions: true,
    });

    expectJSON(result).toDeepEqual({
      errors: [
        {
          message: 'Cannot query field "usr" on type "Query".',
          locations: [{ line: 3, column: 11 }],
        },
      ],
    });
  });

  it('hides suggestions in execution variable errors through graphql()', async () => {
    const source = `
      query ($c: Color) {
        color(filter: { color: $c })
      }
    `;

    const shown = await graphql({
      schema,
      source,
      variableValues: { c: 'RDE' },
    });
    expect(shown.errors?.[0]?.message).to.equal(
      'Variable "$c" got invalid value "RDE"; Value "RDE" does not exist in "Color" enum. Did you mean the enum value "RED"?',
    );

    const hidden = await graphql({
      schema,
      source,
      variableValues: { c: 'RDE' },
      hideSuggestions: true,
    });
    expect(hidden.errors?.[0]?.message).to.equal(
      'Variable "$c" got invalid value "RDE"; Value "RDE" does not exist in "Color" enum.',
    );
  });

  it('hides suggestions in execution variable errors through graphqlSync()', () => {
    const result = graphqlSync({
      schema,
      source: `
        query ($filter: FilterInput) {
          color(filter: $filter)
        }
      `,
      variableValues: { filter: { collor: 'RED' } },
      hideSuggestions: true,
    });

    expect(result.errors?.[0]?.message).to.equal(
      'Variable "$filter" got invalid value { collor: "RED" }; Field "collor" is not defined by type "FilterInput".',
    );
  });

  it('hides suggestions in both phases through graphql()', async () => {
    const source = `
      query ($c: Color) {
        unknownField
        color(filter: { color: $c })
      }
    `;

    // Validation fails first and short-circuits execution.
    const result = await graphql({
      schema,
      source,
      variableValues: { c: 'RDE' },
      hideSuggestions: true,
    });

    expect(result.errors).to.have.lengthOf(1);
    expect(result.errors?.[0]?.message).to.equal(
      'Cannot query field "unknownField" on type "Query".',
    );
    expect(result.errors?.[0]?.message).to.not.include('Did you mean');
  });

  it('hides suggestions in subscription variable errors', async () => {
    const document = parse(`
      subscription ($c: Color) {
        color(filter: { color: $c })
      }
    `);

    const result = await subscribe({
      schema,
      document,
      variableValues: { c: 'RDE' },
      hideSuggestions: true,
    });

    expectJSON(result).toDeepEqual({
      errors: [
        {
          message:
            'Variable "$c" got invalid value "RDE"; Value "RDE" does not exist in "Color" enum.',
          locations: [{ line: 2, column: 21 }],
        },
      ],
    });
  });

  it('hides suggestions when execute receives the option', () => {
    // The flag flows through ExecutionArgs; ensure execute itself accepts it.
    const result = execute({
      schema,
      document: parse(`
        query ($c: Color) {
          color(filter: { color: $c })
        }
      `),
      variableValues: { c: 'RDE' },
      hideSuggestions: true,
    });

    expectJSON(result).toDeepEqual({
      errors: [
        {
          message:
            'Variable "$c" got invalid value "RDE"; Value "RDE" does not exist in "Color" enum.',
          locations: [{ line: 2, column: 16 }],
        },
      ],
    });
  });
});
