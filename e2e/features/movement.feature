@movement
Feature: Player movement
  Background:
    Given I have entered a fresh arena

  @realtime
  Scenario Outline: Walking in either direction
    When I walk <direction>
    And I release the movement controls
    Then I move <direction> from the starting point

    Examples:
      | direction |
      | left      |
      | right     |

  Scenario: Stopping after walking
    When I walk right
    And I release the movement controls
    Then I move right from the starting point
    And I remain where I stopped
