(() => {
  const FACTS = [
    "Koalas sleep or rest for about 18 to 22 hours a day.",
    "Koala fingerprints are so similar to human ones that they are hard to tell apart, even under a microscope.",
    "A newborn koala, called a joey, is about the size of a jelly bean.",
    "Sea otters often hold paws while they rest, so they don't drift apart.",
    "Sea otters keep a handy rock in a pouch of loose skin under their arm, and use it to crack open shellfish.",
    "A group of flamingos is called a flamboyance.",
    "An octopus has three hearts and blue blood.",
    "To a botanist, bananas are berries, but strawberries are not.",
    "A day on Venus is longer than its whole year.",
    "Butterflies taste with their feet.",
    "Wombats make cube-shaped poop.",
    "The Eiffel Tower grows about 15 centimeters taller in summer, because warm metal expands.",
    "Hummingbirds can fly backwards.",
    "There are more trees on Earth than stars in our galaxy: around three trillion trees.",
    "Squirrels bury more nuts than they find again. Some of the forgotten ones grow into new trees.",
    "Scotland's national animal is the unicorn.",
    'Honeybees tell each other where to find flowers by doing a "waggle dance".',
    "Some penguins give a smooth pebble to their partner when they build a nest.",
    "A fluffy white cloud can weigh about as much as 100 elephants.",
    "Dolphins have their own signature whistles that work a bit like names.",
    "Crows can remember human faces for years.",
    "Jupiter is so big that all the other planets in our solar system could fit inside it.",
    "Sunlight takes about eight minutes to travel from the Sun to Earth.",
    "Owls can't move their eyes, so they turn their heads instead, up to about 270 degrees.",
    "Cats usually sleep 12 to 16 hours a day.",
    "Peanuts are not nuts. They are legumes, like peas and beans.",
    "Rainbows are really full circles. From the ground we usually see only the top half.",
    "Apples float in water because about a quarter of an apple is air.",
    "The Moon drifts about 3.8 centimeters farther from Earth each year, about as fast as fingernails grow.",
    "Astronauts can grow up to about 5 centimeters taller in space, because their spines stretch out without gravity.",
    "A giraffe has seven bones in its neck, the same number as you.",
    "Horses can doze standing up, thanks to a special way of locking their legs.",
    "Young sunflowers turn to follow the Sun across the sky during the day.",
    "A group of owls is called a parliament.",
    "Some turtles can breathe through their bottoms while they rest underwater.",
    "Earth is the only planet in our solar system not named after a god.",
    "Honey keeps for a very long time. It holds so little water that germs can't grow in it.",
    "Studies suggest cows have favorite companions and feel calmer when they are together.",
    "Giant pandas spend about 10 to 16 hours a day eating bamboo.",
    "Snow looks white, but each tiny ice crystal is actually clear.",
    "A garden snail has thousands of tiny teeth.",
    "The tallest known tree, a coast redwood named Hyperion, is about 116 meters tall.",
    "Sloths move so slowly that tiny algae grow in their fur, giving them a greenish tint.",
    "Elephants can recognize themselves in a mirror.",
    "Male seahorses carry the eggs in a pouch until the babies are born.",
    "Some parrots and ravens can learn to copy human words.",
  ];
  const get = (id) => document.getElementById(id);
  const fact = get("fact"),
    count = get("fact-count"),
    next = get("next-fact");
  if (!fact || !next) return;

  const order = FACTS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let position = 0;
  const show = () => {
    fact.textContent = FACTS[order[position]];
    if (count) count.textContent = `Fact ${position + 1} of ${order.length}`;
  };
  next.addEventListener("click", () => {
    position = (position + 1) % order.length;
    show();
  });
  show();
})();
