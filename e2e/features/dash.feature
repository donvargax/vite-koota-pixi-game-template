@movement @dash
Feature: Dashing
  Scenario Outline: Dashing in the direction faced
    Given I have entered a fresh arena
    When I compare a <direction> dash with walking
    Then the dash carries me farther <direction> than walking for the same time
    And I remain where I stopped

    Examples:
      | direction |
      | left      |
      | right     |
