import { expect } from 'chai';
import { describe, it } from 'mocha';

import { expectJSON } from '../../__testUtils__/expectJSON';

import { GraphQLError } from '../../error/GraphQLError';

import type { DirectiveNode, FieldNode } from '../../language/ast';
import { parse } from '../../language/parser';

import { buildSchema } from '../../utilities/buildASTSchema';
import { TypeInfo } from '../../utilities/TypeInfo';

import { validate } from '../validate';
import type { ValidationContext } from '../ValidationContext';

import { testSchema } from './harness';

describe('Validate: Supports full validation', () => {
  it('rejects invalid documents', () => {
    // @ts-expect-error (expects a DocumentNode as a second parameter)
    expect(() => validate(testSchema, null)).to.throw('Must provide document.');
  });

  it('validates queries', () => {
    const doc = parse(`
      query {
        human {
          pets {
            ... on Cat {
              meowsVolume
            }
            ... on Dog {
              barkVolume
            }
          }
        }
      }
    `);

    const errors = validate(testSchema, doc);
    expectJSON(errors).toDeepEqual([]);
  });

  it('detects unknown fields', () => {
    const doc = parse(`
      {
        unknown
      }
    `);

    const errors = validate(testSchema, doc);
    expectJSON(errors).toDeepEqual([
      {
        locations: [{ line: 3, column: 9 }],
        message: 'Cannot query field "unknown" on type "QueryRoot".',
      },
    ]);
  });

  it('Deprecated: validates using a custom TypeInfo', () => {
    // This TypeInfo will never return a valid field.
    const typeInfo = new TypeInfo(testSchema, null, () => null);

    const doc = parse(`
      query {
        human {
          pets {
            ... on Cat {
              meowsVolume
            }
            ... on Dog {
              barkVolume
            }
          }
        }
      }
    `);

    const errors = validate(testSchema, doc, undefined, undefined, typeInfo);
    const errorMessages = errors.map((error) => error.message);

    expect(errorMessages).to.deep.equal([
      'Cannot query field "human" on type "QueryRoot". Did you mean "human"?',
      'Cannot query field "meowsVolume" on type "Cat". Did you mean "meowsVolume"?',
      'Cannot query field "barkVolume" on type "Dog". Did you mean "barkVolume"?',
    ]);
  });

  it('validates using a custom rule', () => {
    const schema = buildSchema(`
      directive @custom(arg: String) on FIELD

      type Query {
        foo: String
      }
    `);

    const doc = parse(`
      query {
        name @custom
      }
    `);

    function customRule(context: ValidationContext) {
      return {
        Directive(node: DirectiveNode) {
          const directiveDef = context.getDirective();
          const error = new GraphQLError(
            'Reporting directive: ' + String(directiveDef),
            { nodes: node },
          );
          context.reportError(error);
        },
      };
    }

    const errors = validate(schema, doc, [customRule]);
    expectJSON(errors).toDeepEqual([
      {
        message: 'Reporting directive: @custom',
        locations: [{ line: 3, column: 14 }],
      },
    ]);
  });
});

describe('Validate: Limit maximum number of validation errors', () => {
  const query = `
    {
      firstUnknownField
      secondUnknownField
      thirdUnknownField
    }
  `;
  const doc = parse(query, { noLocation: true });

  function validateDocument(options: { maxErrors?: number }) {
    return validate(testSchema, doc, undefined, options);
  }

  function invalidFieldError(fieldName: string) {
    return {
      message: `Cannot query field "${fieldName}" on type "QueryRoot".`,
    };
  }

  it('when maxErrors is equal to number of errors', () => {
    const errors = validateDocument({ maxErrors: 3 });
    expectJSON(errors).toDeepEqual([
      invalidFieldError('firstUnknownField'),
      invalidFieldError('secondUnknownField'),
      invalidFieldError('thirdUnknownField'),
    ]);
  });

  it('when maxErrors is less than number of errors', () => {
    const errors = validateDocument({ maxErrors: 2 });
    expectJSON(errors).toDeepEqual([
      invalidFieldError('firstUnknownField'),
      invalidFieldError('secondUnknownField'),
      {
        message:
          'Too many validation errors, error limit reached. Validation aborted.',
      },
    ]);
  });

  it('passthrough exceptions from rules', () => {
    function customRule() {
      return {
        Field() {
          throw new Error('Error from custom rule!');
        },
      };
    }
    expect(() =>
      validate(testSchema, doc, [customRule], { maxErrors: 1 }),
    ).to.throw(/^Error from custom rule!$/);
  });
});

describe('Validate: Hide suggestions', () => {
  function validateDocument(
    queryStr: string,
    options?: { hideSuggestions?: boolean },
  ) {
    return validate(testSchema, parse(queryStr), undefined, options);
  }

  it('hides field name suggestions', () => {
    const queryStr = '{ humn }';

    expectJSON(validateDocument(queryStr)).toDeepEqual([
      {
        message:
          'Cannot query field "humn" on type "QueryRoot". Did you mean "human"?',
        locations: [{ line: 1, column: 3 }],
      },
    ]);

    expectJSON(
      validateDocument(queryStr, { hideSuggestions: true }),
    ).toDeepEqual([
      {
        message: 'Cannot query field "humn" on type "QueryRoot".',
        locations: [{ line: 1, column: 3 }],
      },
    ]);
  });

  it('hides argument name suggestions', () => {
    const queryStr = '{ dog { name(surnme: true) } }';

    expectJSON(validateDocument(queryStr)).toDeepEqual([
      {
        message:
          'Unknown argument "surnme" on field "Dog.name". Did you mean "surname"?',
        locations: [{ line: 1, column: 14 }],
      },
    ]);

    expectJSON(
      validateDocument(queryStr, { hideSuggestions: true }),
    ).toDeepEqual([
      {
        message: 'Unknown argument "surnme" on field "Dog.name".',
        locations: [{ line: 1, column: 14 }],
      },
    ]);
  });

  it('hides directive argument name suggestions', () => {
    const schema = buildSchema(`
      directive @myDirective(optArg: String) on FIELD

      type Query {
        foo: String
      }
    `);
    const doc = parse('{ foo @myDirective(optArgg: "x") }');

    expectJSON(validate(schema, doc)).toDeepEqual([
      {
        message:
          'Unknown argument "optArgg" on directive "@myDirective". Did you mean "optArg"?',
        locations: [{ line: 1, column: 20 }],
      },
    ]);

    expectJSON(
      validate(schema, doc, undefined, { hideSuggestions: true }),
    ).toDeepEqual([
      {
        message: 'Unknown argument "optArgg" on directive "@myDirective".',
        locations: [{ line: 1, column: 20 }],
      },
    ]);
  });

  it('hides type name suggestions', () => {
    const queryStr = '{ dog { ... on Dogg { name } } }';

    expectJSON(validateDocument(queryStr)).toDeepEqual([
      {
        message: 'Unknown type "Dogg". Did you mean "Dog"?',
        locations: [{ line: 1, column: 16 }],
      },
    ]);

    expectJSON(
      validateDocument(queryStr, { hideSuggestions: true }),
    ).toDeepEqual([
      {
        message: 'Unknown type "Dogg".',
        locations: [{ line: 1, column: 16 }],
      },
    ]);
  });

  it('hides input object field suggestions', () => {
    const queryStr =
      '{ complicatedArgs { complexArgField(complexArg: { requiredField: true, intFild: 3 }) } }';

    expectJSON(validateDocument(queryStr)).toDeepEqual([
      {
        message:
          'Field "intFild" is not defined by type "ComplexInput". Did you mean "intField"?',
        locations: [{ line: 1, column: 72 }],
      },
    ]);

    expectJSON(
      validateDocument(queryStr, { hideSuggestions: true }),
    ).toDeepEqual([
      {
        message: 'Field "intFild" is not defined by type "ComplexInput".',
        locations: [{ line: 1, column: 72 }],
      },
    ]);
  });

  it('hides enum value suggestions', () => {
    const queryStr = '{ dog { doesKnowCommand(dogCommand: SITZ) } }';

    expectJSON(validateDocument(queryStr)).toDeepEqual([
      {
        message:
          'Value "SITZ" does not exist in "DogCommand" enum. Did you mean the enum value "SIT"?',
        locations: [{ line: 1, column: 37 }],
      },
    ]);

    expectJSON(
      validateDocument(queryStr, { hideSuggestions: true }),
    ).toDeepEqual([
      {
        message: 'Value "SITZ" does not exist in "DogCommand" enum.',
        locations: [{ line: 1, column: 37 }],
      },
    ]);
  });

  it('keeps suggestions when hideSuggestions is false', () => {
    expectJSON(
      validateDocument('{ humn }', { hideSuggestions: false }),
    ).toDeepEqual([
      {
        message:
          'Cannot query field "humn" on type "QueryRoot". Did you mean "human"?',
        locations: [{ line: 1, column: 3 }],
      },
    ]);
  });

  it('exposes hideSuggestions to custom rules', () => {
    const schema = buildSchema(`
      type Query {
        foo: String
      }
    `);
    const doc = parse('{ foo }');

    function customRule(context: ValidationContext) {
      return {
        Field(node: FieldNode) {
          context.reportError(
            new GraphQLError(
              'Custom error.' +
                (context.hideSuggestions ? '' : ' Did you mean "bar"?'),
              { nodes: node },
            ),
          );
        },
      };
    }

    expectJSON(validate(schema, doc, [customRule])).toDeepEqual([
      {
        message: 'Custom error. Did you mean "bar"?',
        locations: [{ line: 1, column: 3 }],
      },
    ]);

    expectJSON(
      validate(schema, doc, [customRule], { hideSuggestions: true }),
    ).toDeepEqual([
      {
        message: 'Custom error.',
        locations: [{ line: 1, column: 3 }],
      },
    ]);
  });
});
