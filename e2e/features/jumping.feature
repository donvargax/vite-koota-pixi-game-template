@visual @jump
Feature: Jumping
  Scenario: Jumping and landing
    Given I have entered a fresh arena
    And I am standing on the arena floor
    When I jump
    Then I am visibly above the floor
    And I land back on the floor
